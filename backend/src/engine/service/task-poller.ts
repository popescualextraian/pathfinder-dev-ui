import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ENGINE_CONFIG, EngineConfig } from '../../commons/engine-config';
import { SessionRecord, TaskRecord, TaskRecordRepository } from '../repository/task-record.repository';
import { BRIDGE_CLIENT_FACTORY, BridgeClientFactory, BridgeEvent, BridgeQuestion, BridgeStatus } from './bridge-client';
import { TaskCostService } from './cost/task-cost.service';
import { TaskUpdates } from './task-updates';
import { MAIN_SESSION, toView, viewsDiffer } from './task-view';

// Tasks polled at the same time: one slow bridge must not hold up the others.
const CONCURRENCY = 4;
const PAGE = 1000;
// A guard against an endless catch-up; the rest follows in the next round.
const MAX_PAGES = 20;
const POLLED_STATES = new Set(['starting', 'running']);
// After these states no question can still be open.
const QUIET_STATES = new Set(['idle', 'suspended', 'stopped', 'failed', 'interrupted']);

// Reads the status view of the event stream of every starting or running task (and of a task right
// after one of our own actions) and keeps the record up to date: state, open questions, the whole
// last agent message and the cursor. Idle, suspended, stopped and closed tasks change only through
// our actions and are not polled. A failed poll is logged and retried in the next round.
@Injectable()
export class TaskPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskPoller.name);
  private timer?: NodeJS.Timeout;
  private round?: Promise<void>;

  constructor(
    private readonly records: TaskRecordRepository,
    @Inject(BRIDGE_CLIENT_FACTORY) private readonly bridgeFor: BridgeClientFactory,
    private readonly updates: TaskUpdates,
    @Inject(ENGINE_CONFIG) private readonly config: Pick<EngineConfig, 'pollSeconds'>,
    private readonly costs: TaskCostService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.config.pollSeconds * 1000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.round;
  }

  // A round that is still running when the next one is due is not doubled up.
  tick(): Promise<void> {
    this.round ??= this.pollAll()
      .catch((error: unknown) => this.logger.warn(`Poll round failed: ${describe(error)}`))
      .finally(() => { this.round = undefined; });
    return this.round;
  }

  private async pollAll(): Promise<void> {
    const acted = this.updates.actedIds();
    const due = (await this.records.list()).filter(
      (r) => !r.closed && r.bridgeUrl !== undefined && r.lastState !== 'stopped' && (POLLED_STATES.has(r.lastState ?? 'starting') || acted.has(r.id)),
    );
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < due.length) {
        const record = due[next++];
        try {
          await this.pollTask(record);
          this.updates.clearActed(record.id);
        } catch (error) {
          this.logger.warn(`Poll of ${record.id} failed, retrying in the next round: ${describe(error)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
    for (const view of await this.costs.recheckDue()) this.updates.changed(view);
  }

  private async pollTask(polled: TaskRecord): Promise<void> {
    const client = this.bridgeFor(polled);
    const events: BridgeEvent[] = [];
    let since = polled.lastSeq ?? 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await client.events(since, PAGE, 'status');
      events.push(...batch);
      if (batch.length < PAGE) break;
      since = Math.max(...batch.map((e) => e.seq));
    }
    if (events.length === 0) return;

    // The patch is computed from the record as it is at write time: a stop, close or answer that came in
    // while the bridge was asked must not be overwritten with older data. Stopped and closed are final.
    let before: TaskRecord | undefined;
    const updated = await this.records.update(polled.id, (current) => {
      before = current;
      if (current.closed || current.lastState === 'stopped') return undefined;
      const patch = applyEvents(current, events);
      const ended = POLLED_STATES.has(current.lastState ?? 'starting') && patch?.lastState !== undefined && !POLLED_STATES.has(patch.lastState);
      return ended ? { ...patch, ...this.costs.armRecheck() } : patch;
    });
    if (before && updated !== before && viewsDiffer(toView(before), toView(updated))) this.updates.changed(toView(updated));
  }
}

// The record patch for the events after the record's cursor, or undefined when there is nothing new.
export function applyEvents(record: TaskRecord, events: BridgeEvent[]): Partial<TaskRecord> | undefined {
  const cursor = record.lastSeq ?? 0;
  const fresh = events.filter((e) => e.seq > cursor).sort((a, b) => a.seq - b.seq);
  if (fresh.length === 0) return undefined;

  const last = (record.lastStatus ?? {}) as Partial<BridgeStatus>;
  let questions: BridgeQuestion[] = [...(last.questions ?? [])];
  let state = record.lastState;
  let reason = last.reason;
  let lastMessage = record.lastMessage;
  let lastMessageAt = record.lastMessageAt;
  let stateSeen = false;
  const sessions: SessionRecord[] = (record.sessions ?? []).map((x) => ({ ...x }));
  let sessionsTouched = false;
  // The session an event names, created from the event when the record does not know it yet.
  const sessionOf = (name: string, ts: string): SessionRecord => {
    let s = sessions.find((x) => x.name === name);
    if (!s) {
      s = { name, state: 'running', createdAt: ts };
      sessions.push(s);
    }
    sessionsTouched = true;
    return s;
  };

  for (const event of fresh) {
    const data = event.data;
    switch (event.type) {
      case 'state':
        if (typeof data.state === 'string' && typeof event.name === 'string') {
          // A session's own state: the task's state is the task-level event.
          const s = sessionOf(event.name, event.ts);
          s.state = data.state;
          s.reason = typeof data.reason === 'string' ? data.reason : '';
          if (QUIET_STATES.has(data.state)) questions = questions.filter((q) => (q.session ?? MAIN_SESSION) !== event.name);
        } else if (typeof data.state === 'string') {
          state = data.state;
          reason = typeof data.reason === 'string' ? data.reason : '';
          stateSeen = true;
          if (QUIET_STATES.has(state)) questions = [];
        }
        break;
      case 'question':
        if (typeof data.id === 'string') {
          questions = questions.filter((q) => q.id !== data.id);
          questions.push({
            id: data.id,
            source: data.source === 'permission' ? 'permission' : 'ask',
            text: typeof data.text === 'string' ? data.text : '',
            options: Array.isArray(data.options) ? data.options.filter((o): o is string => typeof o === 'string') : [],
            recommendation: typeof data.recommendation === 'string' ? data.recommendation : null,
            asked: event.ts,
            session: typeof event.name === 'string' ? event.name : MAIN_SESSION,
          });
        }
        break;
      case 'answer':
        questions = questions.filter((q) => q.id !== data.question);
        break;
      case 'message':
        if (data.final === true && data.role !== 'user' && typeof data.text === 'string') {
          lastMessage = data.text;
          lastMessageAt = event.ts;
          if (typeof event.name === 'string') {
            const s = sessionOf(event.name, event.ts);
            s.lastMessage = data.text;
            s.lastMessageAt = event.ts;
          }
        }
        break;
      default:
        break;
    }
  }

  const patch: Partial<TaskRecord> = {
    lastSeq: fresh[fresh.length - 1].seq,
    lastStatus: { ...(record.lastStatus as object | undefined), state, reason, questions },
  };
  if (stateSeen) patch.lastState = state;
  if (sessionsTouched) patch.sessions = sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (lastMessage !== undefined) {
    patch.lastMessage = lastMessage;
    patch.lastMessageAt = lastMessageAt;
  }
  return patch;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
