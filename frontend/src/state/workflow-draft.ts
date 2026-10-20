import type {
  WorkflowDefinition,
  WorkflowErrorLocation,
  WorkflowSessionDef,
  WorkflowStepDef,
} from '../api/models';

/** Pure, immutable helpers on the draft (a full definition). The first session of the first step is always `main`. */

export const MAIN_SESSION = 'main';
export const MAX_ID_LENGTH = 64;
/** Ids the backend refuses: `new` is the route of an unsaved workflow. */
const RESERVED_IDS = ['new'];

/** `[a-z0-9][a-z0-9-]{0,63}` from free text; '' when nothing usable is left. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/, '');
  return RESERVED_IDS.includes(slug) ? `${slug}-workflow` : slug;
}

/** The slug of a title, made unique among `taken` with -2, -3, ... ('' stays ''). */
export function proposeId(title: string, taken: readonly string[] = []): string {
  const base = slugify(title);
  if (!base || !taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, MAX_ID_LENGTH - suffix.length).replace(/-+$/, '') + suffix;
    if (!taken.includes(candidate)) return candidate;
  }
}

function uniqueName(prefix: string, taken: readonly string[]): string {
  for (let n = 1; ; n++) if (!taken.includes(`${prefix}-${n}`)) return `${prefix}-${n}`;
}

const allSessionNames = (def: WorkflowDefinition) => def.steps.flatMap((s) => s.sessions.map((x) => x.name));
const GENERATED_STEP_ID = /^step-\d+$/;

/** A one-step workflow to start from. */
export function newDraft(): WorkflowDefinition {
  return {
    title: '',
    steps: [{ id: 'step-1', title: '', gate: 'human', sessions: [{ name: MAIN_SESSION, prompt: '' }] }],
  };
}

/** A copy of an existing definition under a new title. */
export function duplicateDraft(def: WorkflowDefinition): WorkflowDefinition {
  const { id: _id, ...copy } = JSON.parse(JSON.stringify(def)) as WorkflowDefinition & { id?: string };
  return { ...copy, title: `${def.title} (copy)` };
}

/** Same structure with the rules of the draft restored: forks only name earlier sessions. Never renames a session. */
export function normalize(def: WorkflowDefinition): WorkflowDefinition {
  const steps = def.steps.map((s) => ({ ...s, sessions: s.sessions.map((x) => ({ ...x })) }));
  const seen = new Set<string>();
  for (const s of steps) {
    for (const x of s.sessions) {
      if (x.fork !== undefined && !seen.has(x.fork)) delete x.fork;
      seen.add(x.name);
    }
  }
  return { ...def, steps };
}

export const setTitle = (def: WorkflowDefinition, title: string): WorkflowDefinition => ({ ...def, title });

export function setDoneStage(def: WorkflowDefinition, doneStage: string | undefined): WorkflowDefinition {
  const { doneStage: _old, ...rest } = def;
  return doneStage ? { ...rest, doneStage } : rest;
}

export function addStep(def: WorkflowDefinition): WorkflowDefinition {
  const ids = def.steps.map((s) => s.id);
  const id = uniqueName('step', ids);
  const name = def.steps.length === 0 ? MAIN_SESSION : uniqueName('session', allSessionNames(def));
  const step: WorkflowStepDef = { id, title: '', gate: 'human', sessions: [{ name, prompt: '' }] };
  return normalize({ ...def, steps: [...def.steps, step] });
}

export function removeStep(def: WorkflowDefinition, index: number): WorkflowDefinition {
  return normalize({ ...def, steps: def.steps.filter((_, i) => i !== index) });
}

function moved<T>(list: readonly T[], index: number, delta: -1 | 1): T[] | null {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return null;
  const copy = [...list];
  [copy[index], copy[to]] = [copy[to], copy[index]];
  return copy;
}

/** The first step holds `main`, which starts the task: it cannot move and nothing moves into its place. */
export const canMoveStep = (length: number, index: number, delta: -1 | 1): boolean =>
  index >= 1 && index + delta >= 1 && index + delta < length;

/** Moves a step one place; out of range, or any move involving the first step, is a no-op. */
export function moveStep(def: WorkflowDefinition, index: number, delta: -1 | 1): WorkflowDefinition {
  if (!canMoveStep(def.steps.length, index, delta)) return def;
  const steps = moved(def.steps, index, delta);
  return steps ? normalize({ ...def, steps }) : def;
}

type StepPatch = Partial<Omit<WorkflowStepDef, 'sessions'>>;

function omitEmpty<T extends object>(obj: T, keys: Array<keyof T>): T {
  const out = { ...obj };
  for (const k of keys) if (out[k] === undefined || out[k] === '') delete out[k];
  return out;
}

/**
 * Updates a step's fields. An empty or undefined `stage` means "don't move the item". When the id was proposed from the
 * title (or is still generated), a new title proposes a new id.
 */
export function updateStep(def: WorkflowDefinition, index: number, patch: StepPatch): WorkflowDefinition {
  const step = def.steps[index];
  if (!step) return def;
  const others = def.steps.filter((_, i) => i !== index).map((s) => s.id);
  let next: WorkflowStepDef = { ...step, ...patch };
  if (patch.title !== undefined && patch.id === undefined) {
    const followed = step.id === proposeId(step.title, others) || GENERATED_STEP_ID.test(step.id);
    const proposal = proposeId(patch.title, others);
    if (followed && proposal) next = { ...next, id: proposal };
  }
  next = omitEmpty(next, ['stage', 'exitPrompt']);
  if (next.requires && next.requires.length === 0) delete next.requires;
  return { ...def, steps: def.steps.map((s, i) => (i === index ? next : s)) };
}

export function toggleGate(def: WorkflowDefinition, index: number): WorkflowDefinition {
  const step = def.steps[index];
  return step ? updateStep(def, index, { gate: step.gate === 'human' ? 'auto' : 'human' }) : def;
}

const withSessions = (def: WorkflowDefinition, stepIndex: number, sessions: WorkflowSessionDef[]) =>
  normalize({ ...def, steps: def.steps.map((s, i) => (i === stepIndex ? { ...s, sessions } : s)) });

export function addSession(def: WorkflowDefinition, stepIndex: number): WorkflowDefinition {
  const step = def.steps[stepIndex];
  if (!step) return def;
  const name = uniqueName('session', allSessionNames(def));
  return withSessions(def, stepIndex, [...step.sessions, { name, prompt: '' }]);
}

/** The first session of the first step cannot be removed. */
export function removeSession(def: WorkflowDefinition, stepIndex: number, sessionIndex: number): WorkflowDefinition {
  const step = def.steps[stepIndex];
  if (!step || !step.sessions[sessionIndex] || isMainSession(stepIndex, sessionIndex)) return def;
  return withSessions(def, stepIndex, step.sessions.filter((_, i) => i !== sessionIndex));
}

/** Moves a session one place within its step; the main session stays first, so nothing moves into or out of its place. */
export function moveSession(
  def: WorkflowDefinition,
  stepIndex: number,
  sessionIndex: number,
  delta: -1 | 1,
): WorkflowDefinition {
  const step = def.steps[stepIndex];
  if (!step) return def;
  if (isMainSession(stepIndex, sessionIndex) || isMainSession(stepIndex, sessionIndex + delta)) return def;
  const sessions = moved(step.sessions, sessionIndex, delta);
  return sessions ? withSessions(def, stepIndex, sessions) : def;
}

/** Updates a session. The main session cannot be renamed; renaming another one follows the forks that name it. */
export function updateSession(
  def: WorkflowDefinition,
  stepIndex: number,
  sessionIndex: number,
  patch: Partial<WorkflowSessionDef>,
): WorkflowDefinition {
  const session = def.steps[stepIndex]?.sessions[sessionIndex];
  if (!session) return def;
  const effective = isMainSession(stepIndex, sessionIndex) ? { ...patch, name: undefined } : patch;
  const { name, ...rest } = effective;
  const updated = omitEmpty({ ...session, ...rest, ...(name !== undefined && { name }) }, ['fork', 'model']);
  const renamed = name !== undefined && name !== session.name;
  const steps = def.steps.map((s, i) => ({
    ...s,
    sessions: s.sessions.map((x, j) => {
      if (i === stepIndex && j === sessionIndex) return updated;
      return renamed && x.fork === session.name ? { ...x, fork: name } : x;
    }),
  }));
  return normalize({ ...def, steps });
}

export const isMainSession = (stepIndex: number, sessionIndex: number) => stepIndex === 0 && sessionIndex === 0;

/** Names a session at (step, session) may start as a copy of: every session before it, in order. */
export function forkOptions(def: WorkflowDefinition, stepIndex: number, sessionIndex: number): string[] {
  const names: string[] = [];
  for (let i = 0; i <= stepIndex && i < def.steps.length; i++) {
    const sessions = def.steps[i].sessions;
    for (let j = 0; j < sessions.length && (i < stepIndex || j < sessionIndex); j++) names.push(sessions[j].name);
  }
  return names;
}

/** The definition as sent: empty optional fields left out. */
export function toWire(def: WorkflowDefinition): WorkflowDefinition {
  const out: WorkflowDefinition = {
    title: def.title,
    steps: def.steps.map((s) => {
      const step = omitEmpty({ ...s, sessions: s.sessions.map((x) => omitEmpty({ ...x }, ['fork', 'model'])) }, [
        'stage',
        'exitPrompt',
      ]);
      if (step.requires) step.requires = step.requires.filter((r) => r !== '');
      if (step.requires && step.requires.length === 0) delete step.requires;
      return step;
    }),
  };
  if (def.doneStage) out.doneStage = def.doneStage;
  return out;
}

/** Equal as sent (empty optional fields do not count). */
export function isSameDefinition(a: WorkflowDefinition, b: WorkflowDefinition): boolean {
  return JSON.stringify(toWire(a)) === JSON.stringify(toWire(b));
}

/** Whether an error names this step (and, with `session`, this session, and with `field`, this field). */
export function errorAt(
  error: WorkflowErrorLocation | null | undefined,
  where: WorkflowErrorLocation,
): boolean {
  if (!error) return false;
  return (
    (where.stepIndex === undefined || error.stepIndex === where.stepIndex) &&
    (where.sessionIndex === undefined || error.sessionIndex === where.sessionIndex) &&
    (where.stepId === undefined || error.stepId === where.stepId) &&
    (where.session === undefined || error.session === where.session) &&
    (where.field === undefined || error.field === where.field)
  );
}

/** The placeholders a prompt may contain (kept in step with `PLACEHOLDERS` of the backend parser). */
export const PLACEHOLDERS = [
  'item.id', 'item.title', 'item.description', 'item.url', 'task.id', 'task.branch', 'step.id',
] as const;
