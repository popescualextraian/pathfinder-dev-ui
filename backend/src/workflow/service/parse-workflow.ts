import { parse } from 'yaml';
import { isSafeRelativePath } from './requires-path';
import type { Gate, SessionDef, StepDef, WorkflowDefinition } from './workflow-definition';

export class WorkflowDefinitionError extends Error {}

export const PLACEHOLDERS = [
  'item.id', 'item.title', 'item.description', 'item.url', 'task.id', 'task.branch', 'step.id',
] as const;

const SESSION_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface ParseOptions {
  /** Stages the work items have; when given, every stage must be one of them. */
  stages?: readonly string[];
}

const fail = (msg: string): never => { throw new WorkflowDefinitionError(msg); };
const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(`${where} must be a non-empty string`);
  return v as string;
}

function optStr(v: unknown, where: string): string | undefined {
  return v === undefined ? undefined : str(v, where);
}

function checkPlaceholders(text: string, where: string): void {
  for (const m of text.matchAll(/\{\{([^}]*)\}\}/g)) {
    const name = m[1].trim();
    if (!(PLACEHOLDERS as readonly string[]).includes(name)) fail(`${where}: unknown placeholder {{${name}}}`);
  }
}

// The first session's prompt is sent to start the task, so the task's own values cannot be in it.
function checkNoTaskPlaceholders(text: string, where: string): void {
  for (const m of text.matchAll(/\{\{([^}]*)\}\}/g)) {
    const name = m[1].trim();
    if (name.startsWith('task.')) fail(`${where}: {{${name}}} is not known before the task starts`);
  }
}

function checkStage(stage: string, where: string, stages?: readonly string[]): void {
  if (stages && !stages.includes(stage)) fail(`${where} "${stage}" is not a stage of the work items (${stages.join(', ')})`);
}

export function parseWorkflowDefinition(id: string, text: string, opts: ParseOptions = {}): WorkflowDefinition {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    return fail(`invalid YAML: ${(e as Error).message.split('\n')[0]}`);
  }
  if (!isMap(doc)) return fail('the document must be a mapping');
  const title = str(doc.title, 'title');
  if (!Array.isArray(doc.steps) || doc.steps.length === 0) fail('steps must be a non-empty list');

  const stepIds = new Set<string>();
  const earlier = new Set<string>();
  const steps: StepDef[] = (doc.steps as unknown[]).map((raw, i) => {
    const at = `steps[${i}]`;
    if (!isMap(raw)) return fail(`${at} must be a mapping`);
    const stepId = str(raw.id, `${at}.id`);
    if (stepIds.has(stepId)) fail(`duplicate step id "${stepId}"`);
    stepIds.add(stepId);
    const stage = str(raw.stage, `${at}.stage`);
    checkStage(stage, `${at}.stage`, opts.stages);
    if (raw.gate !== 'human' && raw.gate !== 'auto') fail(`${at}.gate must be "human" or "auto"`);
    if (!Array.isArray(raw.sessions) || raw.sessions.length === 0) fail(`${at}.sessions must be a non-empty list`);

    const sessions: SessionDef[] = (raw.sessions as unknown[]).map((s, j) => {
      const sat = `${at}.sessions[${j}]`;
      if (!isMap(s)) return fail(`${sat} must be a mapping`);
      const name = str(s.name, `${sat}.name`);
      if (!SESSION_NAME.test(name)) fail(`${sat}: session name "${name}" must match ${SESSION_NAME}`);
      if (i === 0 && j === 0 && name !== 'main') fail(`${sat}: the first session must be named "main"`);
      if (earlier.has(name)) fail(`duplicate session name "${name}"`);
      const prompt = str(s.prompt, `${sat}.prompt`);
      checkPlaceholders(prompt, `${sat}.prompt`);
      if (i === 0 && j === 0) checkNoTaskPlaceholders(prompt, `${sat}.prompt`);
      const fork = optStr(s.fork, `${sat}.fork`);
      if (fork !== undefined && !earlier.has(fork)) fail(`${sat}.fork "${fork}" is not an earlier session`);
      const model = optStr(s.model, `${sat}.model`);
      earlier.add(name);
      return { name, prompt, ...(fork !== undefined && { fork }), ...(model !== undefined && { model }) };
    });

    let requires: string[] | undefined;
    if (raw.requires !== undefined) {
      if (!Array.isArray(raw.requires)) fail(`${at}.requires must be a list of paths`);
      requires = (raw.requires as unknown[]).map((p, k) => {
        const path = str(p, `${at}.requires[${k}]`);
        checkPlaceholders(path, `${at}.requires[${k}]`);
        if (!isSafeRelativePath(path)) fail(`${at}.requires[${k}]: "${path}" must be a relative path inside the worktree (no leading /, no ..)`);
        return path;
      });
    }
    const exitPrompt = optStr(raw.exitPrompt, `${at}.exitPrompt`);
    if (exitPrompt !== undefined) checkPlaceholders(exitPrompt, `${at}.exitPrompt`);
    return {
      id: stepId, title: str(raw.title, `${at}.title`), stage, sessions, gate: raw.gate as Gate,
      ...(requires !== undefined && { requires }), ...(exitPrompt !== undefined && { exitPrompt }),
    };
  });

  const doneStage = optStr(doc.doneStage, 'doneStage');
  if (doneStage !== undefined) checkStage(doneStage, 'doneStage', opts.stages);
  return { id, title, steps, ...(doneStage !== undefined && { doneStage }) };
}
