import type { WorkflowDefinition, WorkflowErrorLocation, WorkflowStepDef } from '../api/models';

/**
 * Pure, immutable helpers on the draft (a full definition). One step is one prompt in one conversation: a new one, the
 * conversation of an earlier step (`continue`), or a copy of it (`fork`). Step ids are never shown: they follow the
 * step's title, and `continue` / `fork` references follow a renamed id.
 */

export const MAX_ID_LENGTH = 64;
/** Step ids match `[a-z0-9][a-z0-9_-]{0,31}` (the backend's STEP_ID). */
export const MAX_STEP_ID_LENGTH = 32;
/** Ids the backend refuses: `new` is the route of an unsaved workflow. */
const RESERVED_IDS = ['new'];
/** The step id `main` is reserved for the first step (its session is `main` anyway). */
const MAIN = 'main';
const GENERATED_STEP_ID = /^step-\d+$/;

function slug(text: string, max: number): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

function unique(base: string, taken: readonly string[], max: number): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, max - suffix.length).replace(/-+$/, '') + suffix;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Workflow id: `[a-z0-9][a-z0-9-]{0,63}` from free text; '' when nothing usable is left. */
export function slugify(text: string): string {
  const s = slug(text, MAX_ID_LENGTH);
  return RESERVED_IDS.includes(s) ? `${s}-workflow` : s;
}

/** The workflow id of a title, made unique among `taken` with -2, -3, ... ('' stays ''). */
export function proposeId(title: string, taken: readonly string[] = []): string {
  const base = slugify(title);
  return base ? unique(base, taken, MAX_ID_LENGTH) : '';
}

function uniqueName(prefix: string, taken: readonly string[]): string {
  for (let n = 1; ; n++) if (!taken.includes(`${prefix}-${n}`)) return `${prefix}-${n}`;
}

/**
 * The id of the step at `index` with this title: the title in lowercase words joined by `-` (max 32), unique among
 * `taken` with -2, -3, ...; `step-N` when the title has nothing usable. `main` is taken for every step but the first.
 */
export function proposeStepId(title: string, taken: readonly string[], index: number): string {
  const all = index > 0 ? [...taken, MAIN] : taken;
  const base = slug(title, MAX_STEP_ID_LENGTH);
  return base ? unique(base, all, MAX_STEP_ID_LENGTH) : uniqueName('step', all);
}

/** A one-step workflow to start from. */
export function newDraft(): WorkflowDefinition {
  return { title: '', steps: [{ id: 'step-1', title: '', gate: 'human', prompt: '' }] };
}

/** A copy of an existing definition under a new title. */
export function duplicateDraft(def: WorkflowDefinition): WorkflowDefinition {
  const { id: _id, ...copy } = JSON.parse(JSON.stringify(def)) as WorkflowDefinition & { id?: string };
  return { ...copy, title: `${def.title} (copy)` };
}

/**
 * Same steps with the rules of the draft restored: `continue` and `fork` only name an earlier step (never on the first
 * step), at most one of them (continue wins), and no model on a continuing step. Never renames a step.
 */
export function normalize(def: WorkflowDefinition): WorkflowDefinition {
  const seen = new Set<string>();
  const steps = def.steps.map((s) => {
    const step = { ...s };
    if (step.continue !== undefined && !seen.has(step.continue)) delete step.continue;
    if (step.fork !== undefined && (!seen.has(step.fork) || step.continue !== undefined)) delete step.fork;
    if (step.continue !== undefined) delete step.model;
    seen.add(step.id);
    return step;
  });
  return { ...def, steps };
}

export const setTitle = (def: WorkflowDefinition, title: string): WorkflowDefinition => ({ ...def, title });

export function setDoneStage(def: WorkflowDefinition, doneStage: string | undefined): WorkflowDefinition {
  const { doneStage: _old, ...rest } = def;
  return doneStage ? { ...rest, doneStage } : rest;
}

export function addStep(def: WorkflowDefinition): WorkflowDefinition {
  const id = proposeStepId('', def.steps.map((s) => s.id), def.steps.length);
  return { ...def, steps: [...def.steps, { id, title: '', gate: 'human', prompt: '' }] };
}

export function removeStep(def: WorkflowDefinition, index: number): WorkflowDefinition {
  return normalize({ ...def, steps: def.steps.filter((_, i) => i !== index) });
}

/** The first step starts the task: it cannot move and nothing moves into its place. */
export const canMoveStep = (length: number, index: number, delta: -1 | 1): boolean =>
  index >= 1 && index + delta >= 1 && index + delta < length;

/** Moves a step one place; out of range, or any move involving the first step, is a no-op. */
export function moveStep(def: WorkflowDefinition, index: number, delta: -1 | 1): WorkflowDefinition {
  if (!canMoveStep(def.steps.length, index, delta)) return def;
  const steps = [...def.steps];
  [steps[index], steps[index + delta]] = [steps[index + delta], steps[index]];
  return normalize({ ...def, steps });
}

/** What `updateStep` changes; the id follows the title, the conversation goes through `setConversation`. */
export type StepPatch = Partial<Omit<WorkflowStepDef, 'id' | 'continue' | 'fork'>>;

function omitEmpty<T extends object>(obj: T, keys: Array<keyof T>): T {
  const out = { ...obj };
  for (const k of keys) if (out[k] === undefined || out[k] === '') delete out[k];
  return out;
}

const OPTIONAL: Array<keyof WorkflowStepDef> = ['stage', 'model', 'continue', 'fork', 'exitPrompt'];

function renameReferences(steps: WorkflowStepDef[], from: string, to: string): WorkflowStepDef[] {
  return steps.map((s) => ({
    ...s,
    ...(s.continue === from && { continue: to }),
    ...(s.fork === from && { fork: to }),
  }));
}

/**
 * Updates a step's fields; empty optional fields are dropped (an empty `stage` means "don't move the item"). A new
 * title gives the step a new id when it yields another one; the steps continuing or copying it follow.
 */
export function updateStep(def: WorkflowDefinition, index: number, patch: StepPatch): WorkflowDefinition {
  const step = def.steps[index];
  if (!step) return def;
  let next: WorkflowStepDef = omitEmpty({ ...step, ...patch }, OPTIONAL);
  if (next.requires && next.requires.length === 0) delete next.requires;
  let steps = def.steps.map((s, i) => (i === index ? next : s));
  if (patch.title !== undefined) {
    const others = def.steps.filter((_, i) => i !== index).map((s) => s.id);
    const keep = GENERATED_STEP_ID.test(step.id) && !slug(patch.title, MAX_STEP_ID_LENGTH) && !others.includes(step.id);
    const id = keep || slug(patch.title, MAX_STEP_ID_LENGTH) === step.id ? step.id : proposeStepId(patch.title, others, index);
    if (id !== step.id) {
      next = { ...next, id };
      steps = renameReferences(steps.map((s, i) => (i === index ? next : s)), step.id, id);
    }
  }
  return normalize({ ...def, steps });
}

export function toggleGate(def: WorkflowDefinition, index: number): WorkflowDefinition {
  const step = def.steps[index];
  return step ? updateStep(def, index, { gate: step.gate === 'human' ? 'auto' : 'human' }) : def;
}

/** The conversation a step runs in: a new one, an earlier step's (continue), or a copy of an earlier step's (fork). */
export type Conversation = { kind: 'new' } | { kind: 'continue'; step: string } | { kind: 'fork'; step: string };

export function conversationOf(step: WorkflowStepDef): Conversation {
  if (step.continue !== undefined) return { kind: 'continue', step: step.continue };
  if (step.fork !== undefined) return { kind: 'fork', step: step.fork };
  return { kind: 'new' };
}

/** The steps whose conversation the step at `index` may continue or copy: the earlier ones, in order. */
export function conversationChoices(def: WorkflowDefinition, index: number): Array<{ id: string; title: string }> {
  return def.steps.slice(0, Math.max(0, index)).map((s) => ({ id: s.id, title: s.title }));
}

/** Sets the conversation; a continuing step has no model of its own. A step that is not earlier is refused (no-op). */
export function setConversation(def: WorkflowDefinition, index: number, conversation: Conversation): WorkflowDefinition {
  const step = def.steps[index];
  if (!step) return def;
  if (conversation.kind !== 'new' && !conversationChoices(def, index).some((c) => c.id === conversation.step)) return def;
  const { continue: _c, fork: _f, ...rest } = step;
  const next: WorkflowStepDef =
    conversation.kind === 'continue'
      ? { ...rest, continue: conversation.step }
      : conversation.kind === 'fork'
        ? { ...rest, fork: conversation.step }
        : rest;
  if (next.continue !== undefined) delete next.model;
  return { ...def, steps: def.steps.map((s, i) => (i === index ? next : s)) };
}

/** A step's title by its id, for showing references (`Step N` when untitled, the id when there is no such step). */
export function stepTitle(def: WorkflowDefinition, id: string): string {
  const i = def.steps.findIndex((s) => s.id === id);
  if (i < 0) return id;
  return def.steps[i].title || `Step ${i + 1}`;
}

/** The definition as sent: empty optional fields left out. */
export function toWire(def: WorkflowDefinition): WorkflowDefinition {
  const out: WorkflowDefinition = {
    title: def.title,
    steps: def.steps.map((s) => {
      const step = omitEmpty({ ...s }, OPTIONAL);
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

/** Whether an error names this step (by id or index) and, with `field`, this field. */
export function errorAt(error: WorkflowErrorLocation | null | undefined, where: WorkflowErrorLocation): boolean {
  if (!error) return false;
  return (
    (where.stepIndex === undefined || error.stepIndex === where.stepIndex) &&
    (where.stepId === undefined || error.stepId === where.stepId) &&
    (where.field === undefined || error.field === where.field)
  );
}

/** The placeholders a prompt may contain (kept in step with `PLACEHOLDERS` of the backend parser). */
export const PLACEHOLDERS = [
  'item.id', 'item.title', 'item.description', 'item.url', 'task.id', 'task.branch', 'step.id',
] as const;

/** Placeholders that are empty before the task exists: not in the first step's prompt. */
export const isTaskPlaceholder = (name: string) => name.startsWith('task.');
