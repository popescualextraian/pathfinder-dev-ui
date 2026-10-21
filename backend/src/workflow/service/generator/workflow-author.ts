import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillInput {
  description: string;
  /** Lane ids (the work items' stages) the draft may use. */
  stages: readonly string[];
}

// The skill is a Markdown file next to this one; nest-cli.json copies it to dist.
let template: string | undefined;
function loadTemplate(): string {
  template ??= readFileSync(join(__dirname, 'workflow-author.md'), 'utf8').trimEnd();
  return template;
}

/**
 * The prompt that asks an agent to write `workflow-draft.yaml`: the skill with the allowed lanes filled in and the
 * human's description last, unchanged (function replacers: `$` in the text is not a replacement pattern).
 */
export function fillSkill({ description, stages }: SkillInput): string {
  const lanes = stages.length > 0 ? stages.map((s) => `- \`${s}\``).join('\n') : '(none: leave `stage` and `doneStage` out)';
  // Description last and replaced last, so nothing in it is ever expanded.
  return loadTemplate().replace('%%STAGES%%', () => lanes).replace('%%DESCRIPTION%%', () => description);
}
