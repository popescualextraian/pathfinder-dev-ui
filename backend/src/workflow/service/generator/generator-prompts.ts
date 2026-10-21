import type { WorkflowValidationError } from '../workflow-definitions.service';

/** The file the agent writes at the root of its worktree. */
export const DRAFT_FILE = 'workflow-draft.yaml';

function where(error: WorkflowValidationError): string {
  const parts: string[] = [];
  if (error.stepId !== undefined) parts.push(`step "${error.stepId}"`);
  else if (error.stepIndex !== undefined) parts.push(`step ${error.stepIndex + 1}`);
  if (error.field !== undefined) parts.push(`field \`${error.field}\``);
  return parts.length > 0 ? `${parts.join(', ')}: ` : '';
}

/** Sent to the agent when its draft did not pass the check: the errors, and fix `attempt` of `maxAttempts`. */
export function fixPrompt(errors: readonly WorkflowValidationError[], attempt: number, maxAttempts: number): string {
  return [
    `The file \`${DRAFT_FILE}\` at the root of your worktree did not pass the workflow check:`,
    '',
    ...errors.map((e) => `- ${where(e)}${e.message}`),
    '',
    `Correct \`${DRAFT_FILE}\` in place (rewrite that file at the root of your worktree, do not write another one), keep`
      + ' what was right, and finish with a short note of what you changed. The file is checked again when you finish;'
      + ` this is fix ${attempt} of ${maxAttempts}.`,
  ].join('\n');
}

/** Sent to the agent when the human asks for changes to a ready draft: their text unchanged, then the reminder. */
export function changesPrompt(text: string): string {
  return [
    `The human reviewed the workflow in \`${DRAFT_FILE}\` and asks for changes:`,
    '',
    '<change-request>',
    text,
    '</change-request>',
    '',
    `Rewrite \`${DRAFT_FILE}\` at the root of your worktree with these changes (the file is checked again when you`
      + ' finish; nothing else is read), and finish with a short note of what you changed.',
  ].join('\n');
}
