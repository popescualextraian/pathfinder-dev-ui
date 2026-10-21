import { parse } from 'yaml';
import { validateWorkflowDefinition, WorkflowDefinitionError } from './parse-workflow';
import { serializeWorkflowDefinition } from './serialize-workflow';

export type ConvertResult =
  | { kind: 'unchanged' }
  | { kind: 'converted'; text: string }
  | { kind: 'refused'; error: string };

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Old format (a step has `sessions:`) to the new one (a step has one prompt). Written through the validator and
 * serializer of the editor, so comments are lost. A step with more than one session is refused (nothing is
 * written); a file without `sessions:` steps is left alone.
 */
export function convertOldWorkflowText(id: string, text: string): ConvertResult {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    return { kind: 'refused', error: `invalid YAML: ${(e as Error).message.split('\n')[0]}` };
  }
  if (!isMap(doc) || !Array.isArray(doc.steps) || !doc.steps.some((s) => isMap(s) && 'sessions' in s)) return { kind: 'unchanged' };

  // Session name -> id of the step that owns it, for the forks.
  const owner = new Map<string, string>();
  const steps: unknown[] = [];
  for (const raw of doc.steps as unknown[]) {
    if (!isMap(raw) || !Array.isArray(raw.sessions)) return { kind: 'refused', error: 'a step has no sessions list; fix the file by hand' };
    const stepId = String(raw.id);
    if (raw.sessions.length !== 1) {
      return { kind: 'refused', error: `step "${stepId}" has ${raw.sessions.length} sessions; a step has one conversation now: split it into steps by hand` };
    }
    const session = raw.sessions[0];
    if (!isMap(session)) return { kind: 'refused', error: `step "${stepId}": the session must be a mapping` };
    const { sessions: _dropped, ...rest } = raw; // eslint-disable-line @typescript-eslint/no-unused-vars
    let fork: string | undefined;
    if (session.fork !== undefined) {
      fork = typeof session.fork === 'string' ? owner.get(session.fork) : undefined;
      if (fork === undefined) return { kind: 'refused', error: `step "${stepId}": the session forks "${String(session.fork)}", which is not a session of an earlier step` };
    }
    if (typeof session.name === 'string') owner.set(session.name, stepId);
    steps.push({
      ...rest,
      prompt: session.prompt,
      ...(session.model !== undefined && { model: session.model }),
      ...(fork !== undefined && { fork }),
    });
  }
  try {
    return { kind: 'converted', text: serializeWorkflowDefinition(validateWorkflowDefinition(id, { ...doc, steps })) };
  } catch (e) {
    if (e instanceof WorkflowDefinitionError) return { kind: 'refused', error: e.message };
    throw e;
  }
}
