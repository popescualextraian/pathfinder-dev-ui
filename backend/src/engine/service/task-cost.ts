import type { TaskCost } from '../repository/task-record.repository';
// What a task cost so far: token counts and USD per source (estimate, billed credits, unknown;
// never summed across sources), from the cost plugin's ledger in the task container.
// Poll rounds in which a task whose turn ended gets its ledger re-read (the hook may write late).
export const COST_RECHECKS = 3;

export type { TaskCost };

interface Totals { input: number; output: number; cache_read: number; cache_write: number; cost: Record<string, number> }
interface Snapshot { ts: string; totals: Totals }

const SOURCE_KEYS: Record<string, 'estimate' | 'billedCredits' | 'unknown'> = {
  estimate: 'estimate', 'billed-credits': 'billedCredits', unknown: 'unknown',
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isTokens = (v: unknown): boolean => isObject(v) && [v.input, v.output, v.cache_read, v.cache_write].every(isCount);
const isSource = (v: string): boolean => Object.hasOwn(SOURCE_KEYS, v);

// The same check as valid_record in the cost plugin's record.jq (schema/cost-record.schema.json).
function validRecord(r: unknown, task: string): r is Record<string, unknown> & { harness: string; session: string; ts: string; totals: Totals } {
  if (!isObject(r) || r.schema !== 'cost-record/v1') return false;
  const { ts, project, harness, session, context, models, totals } = r;
  if (typeof ts !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ts)) return false;
  if (typeof project !== 'string') return false;
  if (typeof harness !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(harness)) return false;
  if (typeof session !== 'string' || session.length === 0 || session.length > 200) return false;
  if (!isObject(context) || !['task', 'scheduled', 'dev'].includes(context.kind as string)) return false;
  if (typeof (context.task ?? '') !== 'string' || typeof (context.schedule ?? '') !== 'string') return false;
  if (!Array.isArray(models) || !models.every((m) => isTokens(m) && typeof m.model === 'string'
    && typeof m.cost === 'number' && m.cost >= 0 && isSource(m.cost_source))) return false;
  if (!isTokens(totals) || !isObject((totals as Totals).cost)) return false;
  if (!Object.entries((totals as Totals).cost).every(([k, v]) => isSource(k) && typeof v === 'number' && v >= 0)) return false;
  return context.task === task;
}

// Raw ledger lines in; the latest snapshot of each session (harness + session) counts, summed.
// undefined when no line is a valid record of this task.
export function summarizeLedger(text: string, taskId: string, readAt: string): TaskCost | undefined {
  const latest = new Map<string, Snapshot>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record: unknown;
    try { record = JSON.parse(line); } catch { continue; }
    if (validRecord(record, taskId)) latest.set(`${record.harness}/${record.session}`, { ts: record.ts, totals: record.totals });
  }
  if (latest.size === 0) return undefined;
  const cost: TaskCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: {}, sessions: latest.size, snapshotAt: '', readAt };
  for (const { ts, totals } of latest.values()) {
    cost.input += totals.input;
    cost.output += totals.output;
    cost.cacheRead += totals.cache_read;
    cost.cacheWrite += totals.cache_write;
    for (const [source, usd] of Object.entries(totals.cost)) {
      const key = SOURCE_KEYS[source];
      cost.usd[key] = (cost.usd[key] ?? 0) + usd;
    }
    if (ts > cost.snapshotAt) cost.snapshotAt = ts;
  }
  return cost;
}
