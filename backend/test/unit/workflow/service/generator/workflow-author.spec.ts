import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { fillSkill } from '../../../../../src/workflow/service/generator/workflow-author';
import { OLD_FORMAT_MESSAGE, parseWorkflowDefinition } from '../../../../../src/workflow/service/parse-workflow';

const root = join(__dirname, '../../../../../..');
const stages: string[] = (parse(readFileSync(join(root, 'backlog.example.yaml'), 'utf8')).lanes as { id: string }[]).map((l) => l.id);
const skillFile = readFileSync(join(root, 'backend/src/workflow/service/generator/workflow-author.md'), 'utf8');

const fences = (text: string): string[] => [...text.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map((m) => m[1]);

describe('workflow-author skill', () => {
  it('has two yaml examples, each valid for the lanes of backlog.example.yaml', () => {
    const blocks = fences(skillFile);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(() => parseWorkflowDefinition('example', b, { stages })).not.toThrow();
  });

  it('embeds the workflows.example files', () => {
    const blocks = fences(skillFile).map((b) => parse(b));
    for (const name of ['implement-review', 'plan-implement-review']) {
      expect(blocks).toContainEqual(parse(readFileSync(join(root, 'workflows.example', `${name}.yaml`), 'utf8')));
    }
  });

  it('writes the draft at the worktree root and does not send the agent to an API', () => {
    expect(skillFile).toContain('`workflow-draft.yaml`');
    expect(skillFile).not.toMatch(/\/api\/|curl|POST /);
  });

  it('states the rules the validator enforces', () => {
    for (const w of ['main', 'continue', 'fork', 'model', 'requires', 'exitPrompt', 'doneStage', 'agentic-ask', 'sessions:']) expect(skillFile).toContain(w);
    for (const p of ['item.id', 'item.title', 'item.description', 'item.url', 'task.id', 'task.branch', 'step.id']) expect(skillFile).toContain(`{{${p}}}`);
    expect(OLD_FORMAT_MESSAGE).toContain('sessions:');
  });
});

describe('fillSkill', () => {
  it('fills the lanes and leaves no marker behind', () => {
    const out = fillSkill({ description: 'x', stages });
    for (const s of stages) expect(out).toContain(`- \`${s}\``);
    expect(out).not.toContain('%%');
  });

  it('puts the description last, unchanged, whatever it contains', () => {
    const description = 'Use $& and $1 and $$ and {{item.id}} and %%STAGES%% and ```yaml\nx: 1\n```\n  trailing  ';
    const out = fillSkill({ description, stages });
    expect(out.endsWith(description)).toBe(true);
    expect(out.indexOf("HD's description (the input)")).toBeLessThan(out.length - description.length);
    expect(out.split(description)).toHaveLength(2);
  });

  it('keeps the filled skill valid: its yaml examples still validate', () => {
    for (const b of fences(fillSkill({ description: 'd', stages }))) expect(() => parseWorkflowDefinition('e', b, { stages })).not.toThrow();
  });

  it('copes with no lanes', () => {
    expect(fillSkill({ description: 'd', stages: [] })).toContain('leave `stage`');
  });
});
