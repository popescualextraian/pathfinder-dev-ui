import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/http';
import type { WorkflowGenerationState, WorkflowGenerationSummary, WorkflowGenerationView } from '../api/models';
import * as tasks from '../api/tasks-api';
import * as api from '../api/workflows-api';

/** How often the open generations are read while one of them is active. */
export const GENERATION_POLL_MS = 3000;

const ACTIVE: readonly WorkflowGenerationState[] = ['writing', 'asking', 'fixing'];
export const isActiveGeneration = (g: Pick<WorkflowGenerationSummary, 'state'>) => ACTIVE.includes(g.state);

export interface GenerationActionState {
  pending: boolean;
  error: string | null;
}
const IDLE: GenerationActionState = { pending: false, error: null };

const READ_ONLY = 'Workflows are read-only here: the workflows folder is not writable.';
const messageOf = (e: unknown) =>
  e instanceof ApiError && e.status === 403 ? READ_ONLY : e instanceof Error ? e.message : String(e);

const summaryOf = (view: WorkflowGenerationView): WorkflowGenerationSummary => {
  const { draft, ...rest } = view;
  return { ...rest, hasDraft: draft !== undefined };
};
const isOpen = (g: { state: WorkflowGenerationState }) => g.state !== 'saved' && g.state !== 'discarded';

export type ActionResult<T> = { ok: true; value: T } | { ok: false };

/**
 * Open workflow generations: listed once, then polled every GENERATION_POLL_MS while at least one is
 * writing/asking/fixing (ready/failed need no polling). Actions never reject; they return `{ok}` and keep
 * pending/error per generation (`actionState(id)`, `startState` for start).
 */
export function useWorkflowGenerations(pollMs: number = GENERATION_POLL_MS) {
  const [generations, setGenerations] = useState<WorkflowGenerationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<Record<string, GenerationActionState>>({});
  const [startState, setStartState] = useState<GenerationActionState>(IDLE);

  const alive = useRef(true);
  const seq = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const list = await api.listGenerations();
      if (!alive.current || mine !== seq.current) return;
      setGenerations(list);
      setError(null);
    } catch (e) {
      if (alive.current && mine === seq.current) setError(messageOf(e));
    } finally {
      if (alive.current && mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const anyActive = generations.some(isActiveGeneration);
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => void reload(), pollMs);
    return () => clearInterval(timer);
  }, [anyActive, pollMs, reload]);

  /** Replaces (or adds) a generation from an action's response; saved/discarded leave the open list. */
  const apply = useCallback((view: WorkflowGenerationView) => {
    if (!alive.current) return;
    seq.current++; // an older list response must not undo this
    setGenerations((list) => {
      const rest = list.filter((g) => g.id !== view.id);
      if (!isOpen(view)) return rest;
      const next = summaryOf(view);
      return list.some((g) => g.id === view.id) ? list.map((g) => (g.id === view.id ? next : g)) : [...rest, next];
    });
  }, []);

  const setAction = useCallback((id: string, state: GenerationActionState) => {
    if (alive.current) setActions((a) => ({ ...a, [id]: state }));
  }, []);

  const perform = useCallback(
    async <T>(id: string, call: () => Promise<T>, after: (value: T) => void): Promise<ActionResult<T>> => {
      setAction(id, { pending: true, error: null });
      try {
        const value = await call();
        after(value);
        setAction(id, IDLE);
        return { ok: true, value };
      } catch (e) {
        setAction(id, { pending: false, error: messageOf(e) });
        void reload(); // the server's state is the truth after a refused action
        return { ok: false };
      }
    },
    [reload, setAction],
  );

  const start = useCallback(
    async (description: string, model?: string): Promise<ActionResult<WorkflowGenerationView>> => {
      setStartState({ pending: true, error: null });
      try {
        const value = await (model ? api.startGeneration(description, model) : api.startGeneration(description));
        apply(value);
        if (alive.current) setStartState(IDLE);
        return { ok: true, value };
      } catch (e) {
        if (alive.current) setStartState({ pending: false, error: messageOf(e) });
        return { ok: false };
      }
    },
    [apply],
  );

  const requestChanges = useCallback(
    (id: string, text: string) => perform(id, () => api.requestGenerationChanges(id, text), apply),
    [perform, apply],
  );
  const discard = useCallback((id: string) => perform(id, () => api.discardGeneration(id), apply), [perform, apply]);

  /** Answers the generator's open question through the task answer API, then reads the generation again. */
  const answer = useCallback(
    async (generation: WorkflowGenerationSummary, text: string): Promise<ActionResult<void>> => {
      const question = generation.question;
      if (!question) {
        setAction(generation.id, { pending: false, error: 'There is no open question.' });
        return { ok: false };
      }
      return perform(
        generation.id,
        async () => {
          await tasks.answer(generation.taskId, { text, question: question.id, session: question.session });
        },
        () => void reload(),
      );
    },
    [perform, reload, setAction],
  );

  const actionState = useCallback((id: string): GenerationActionState => actions[id] ?? IDLE, [actions]);

  return { generations, loading, error, startState, actionState, start, requestChanges, discard, answer, reload };
}
