import { parse } from 'yaml';
import { validateWorkflowDefinition, WorkflowDefinitionError } from '../parse-workflow';
import type { WorkflowDefinition } from '../workflow-definition';
import type { WorkflowValidationError } from '../workflow-definitions.service';
import { DRAFT_FILE } from './generator-prompts';

export type DraftCheck =
  | { valid: true; definition: WorkflowDefinition }
  /** `draft`: the parsed document when it is a mapping (it may be opened in the editor anyway). */
  | { valid: false; errors: WorkflowValidationError[]; draft?: Record<string, unknown> };

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The agent's draft (its text, null when the file is missing) judged by the editor's validator with the work items'
 * stages: the definition (id `draft`; the editor proposes the real one) or the first error with its location.
 */
export function checkDraft(text: string | null, stages?: readonly string[]): DraftCheck {
  if (text === null) return { valid: false, errors: [{ message: `${DRAFT_FILE} was not found at the root of your worktree` }] };
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    // Same message as parseWorkflowDefinition gives for a workflow file.
    return { valid: false, errors: [{ message: `invalid YAML: ${(e as Error).message.split('\n')[0]}` }] };
  }
  try {
    return { valid: true, definition: validateWorkflowDefinition('draft', doc, { stages }) };
  } catch (e) {
    if (!(e instanceof WorkflowDefinitionError)) throw e;
    return { valid: false, errors: [{ message: e.message, ...e.location }], ...(isMap(doc) && { draft: doc }) };
  }
}
