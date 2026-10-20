import { parse } from 'yaml';
import { isSafeRelativePath } from './requires-path';
import type { Gate, SessionDef, StepDef, WorkflowDefinition } from './workflow-definition';

export interface WorkflowErrorLocation {
  stepId?: string;
  session?: string;
  /** Index of the step / session, set when its id / name is unusable (missing or empty), so it cannot be named. */
  stepIndex?: number;
  sessionIndex?: number;
  field?: string;
}

/** A refused definition; `location` says where (stable, for editors), the message is the text of load errors. */
export class WorkflowDefinitionError extends Error {
  readonly location: WorkflowErrorLocation;
  constructor(message: string, location: WorkflowErrorLocation = {}) {
    super(message);
    this.name = 'WorkflowDefinitionError';
    this.location = location;
  }
}

export const PLACEHOLDERS = [
  'item.id', 'item.title', 'item.description', 'item.url', 'task.id', 'task.branch', 'step.id',
] as const;

/** Ids of workflows (file names without extension) chosen at create. */
export const WORKFLOW_ID = /^(?!new$)[a-z0-9][a-z0-9-]{0,63}$/;
export const WORKFLOW_ID_MESSAGE = `The workflow id must match ${WORKFLOW_ID} ("new" is reserved: it is the editor's route for a new workflow)`;
const SESSION_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface ParseOptions {
  /** Stages the work items have; when given, every stage must be one of them. */
  stages?: readonly string[];
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, where: string, loc: WorkflowErrorLocation): string {
  if (typeof v !== 'string' || v.trim() === '') throw new WorkflowDefinitionError(`${where} must be a non-empty string`, loc);
  return v;
}

function optStr(v: unknown, where: string, loc: WorkflowErrorLocation): string | undefined {
  return v === undefined ? undefined : str(v, where, loc);
}

function checkPlaceholders(text: string, where: string, loc: WorkflowErrorLocation): void {
  for (const m of text.matchAll(/\{\{([^}]*)\}\}/g)) {
    const name = m[1].trim();
    if (!(PLACEHOLDERS as readonly string[]).includes(name)) throw new WorkflowDefinitionError(`${where}: unknown placeholder {{${name}}}`, loc);
  }
}

// The first session's prompt is sent to start the task, so the task's own values cannot be in it.
function checkNoTaskPlaceholders(text: string, where: string, loc: WorkflowErrorLocation): void {
  for (const m of text.matchAll(/\{\{([^}]*)\}\}/g)) {
    const name = m[1].trim();
    if (name.startsWith('task.')) throw new WorkflowDefinitionError(`${where}: {{${name}}} is not known before the task starts`, loc);
  }
}

function checkStage(stage: string, where: string, loc: WorkflowErrorLocation, stages?: readonly string[]): void {
  if (stages && !stages.includes(stage)) {
    throw new WorkflowDefinitionError(`${where} "${stage}" is not a stage of the work items (${stages.join(', ')})`, loc);
  }
}

export function parseWorkflowDefinition(id: string, text: string, opts: ParseOptions = {}): WorkflowDefinition {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    throw new WorkflowDefinitionError(`invalid YAML: ${(e as Error).message.split('\n')[0]}`);
  }
  return validateWorkflowDefinition(id, doc, opts);
}

/**
 * The one validator, on the parsed object (a YAML document or a client's JSON). Throws the FIRST error with its
 * location; returns the normalized definition (unknown keys dropped).
 */
export function validateWorkflowDefinition(id: string, doc: unknown, opts: ParseOptions = {}): WorkflowDefinition {
  const fail = (msg: string, loc: WorkflowErrorLocation = {}): never => { throw new WorkflowDefinitionError(msg, loc); };
  if (!isMap(doc)) return fail('the document must be a mapping');
  const title = str(doc.title, 'title', { field: 'title' });
  if (!Array.isArray(doc.steps) || doc.steps.length === 0) fail('steps must be a non-empty list', { field: 'steps' });

  const stepIds = new Set<string>();
  const earlier = new Set<string>();
  const steps: StepDef[] = (doc.steps as unknown[]).map((raw, i) => {
    const at = `steps[${i}]`;
    if (!isMap(raw)) return fail(`${at} must be a mapping`);
    const stepId = str(raw.id, `${at}.id`, { stepIndex: i, field: 'id' });
    const sl = (field: string, session?: string): WorkflowErrorLocation => ({ stepId, ...(session !== undefined && { session }), field });
    if (stepIds.has(stepId)) fail(`duplicate step id "${stepId}"`, sl('id'));
    stepIds.add(stepId);
    const stepTitle = str(raw.title, `${at}.title`, sl('title'));
    const stage = optStr(raw.stage, `${at}.stage`, sl('stage'));
    if (stage !== undefined) checkStage(stage, `${at}.stage`, sl('stage'), opts.stages);
    if (raw.gate !== 'human' && raw.gate !== 'auto') fail(`${at}.gate must be "human" or "auto"`, sl('gate'));
    if (!Array.isArray(raw.sessions) || raw.sessions.length === 0) fail(`${at}.sessions must be a non-empty list`, sl('sessions'));

    const sessions: SessionDef[] = (raw.sessions as unknown[]).map((s, j) => {
      const sat = `${at}.sessions[${j}]`;
      if (!isMap(s)) return fail(`${sat} must be a mapping`, sl('sessions'));
      const name = str(s.name, `${sat}.name`, { stepId, sessionIndex: j, field: 'name' });
      const loc = (field: string): WorkflowErrorLocation => sl(field, name);
      if (!SESSION_NAME.test(name)) fail(`${sat}: session name "${name}" must match ${SESSION_NAME}`, loc('name'));
      if (i === 0 && j === 0 && name !== 'main') fail(`${sat}: the first session must be named "main"`, loc('name'));
      if (earlier.has(name)) fail(`duplicate session name "${name}"`, loc('name'));
      const prompt = str(s.prompt, `${sat}.prompt`, loc('prompt'));
      checkPlaceholders(prompt, `${sat}.prompt`, loc('prompt'));
      if (i === 0 && j === 0) checkNoTaskPlaceholders(prompt, `${sat}.prompt`, loc('prompt'));
      const fork = optStr(s.fork, `${sat}.fork`, loc('fork'));
      if (fork !== undefined && !earlier.has(fork)) fail(`${sat}.fork "${fork}" is not an earlier session`, loc('fork'));
      const model = optStr(s.model, `${sat}.model`, loc('model'));
      earlier.add(name);
      return { name, prompt, ...(fork !== undefined && { fork }), ...(model !== undefined && { model }) };
    });

    let requires: string[] | undefined;
    if (raw.requires !== undefined) {
      if (!Array.isArray(raw.requires)) fail(`${at}.requires must be a list of paths`, sl('requires'));
      requires = (raw.requires as unknown[]).map((p, k) => {
        const path = str(p, `${at}.requires[${k}]`, sl('requires'));
        checkPlaceholders(path, `${at}.requires[${k}]`, sl('requires'));
        if (!isSafeRelativePath(path)) {
          fail(`${at}.requires[${k}]: "${path}" must be a relative path inside the worktree (no leading /, no ..)`, sl('requires'));
        }
        return path;
      });
    }
    const exitPrompt = optStr(raw.exitPrompt, `${at}.exitPrompt`, sl('exitPrompt'));
    if (exitPrompt !== undefined) checkPlaceholders(exitPrompt, `${at}.exitPrompt`, sl('exitPrompt'));
    return {
      id: stepId, title: stepTitle, ...(stage !== undefined && { stage }), sessions, gate: raw.gate as Gate,
      ...(requires !== undefined && { requires }), ...(exitPrompt !== undefined && { exitPrompt }),
    };
  });

  const doneStage = optStr(doc.doneStage, 'doneStage', { field: 'doneStage' });
  if (doneStage !== undefined) checkStage(doneStage, 'doneStage', { field: 'doneStage' }, opts.stages);
  return { id, title, steps, ...(doneStage !== undefined && { doneStage }) };
}
