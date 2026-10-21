import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { parseWorkflowDefinition } from '../../../../src/workflow/service/parse-workflow';
import { serializeWorkflowDefinition } from '../../../../src/workflow/service/serialize-workflow';
import type { WorkflowDefinition } from '../../../../src/workflow/service/workflow-definition';

const dir = join(__dirname, '../../../../../workflows.example');

describe('serializeWorkflowDefinition', () => {
  it.each(readdirSync(dir))('round trips %s', (file) => {
    const id = file.replace(/\.ya?ml$/, '');
    const def = parseWorkflowDefinition(id, readFileSync(join(dir, file), 'utf8'));
    const text = serializeWorkflowDefinition(def);
    expect(parseWorkflowDefinition(id, text)).toEqual(def);
    expect(serializeWorkflowDefinition(parseWorkflowDefinition(id, text))).toBe(text);
    expect(text).not.toMatch(/^\s*[\w-]+: [[{]/m); // block lists and maps only
  });

  it('round trips awkward strings and keeps multi-line prompts as block scalars', () => {
    const def: WorkflowDefinition = {
      id: 'x', title: '{{item.title}}: "quoted" # not a comment',
      steps: [
        {
          id: 'a', title: '- dash', stage: 'plan', gate: 'human', requires: ['plans/{{item.id}}.md'],
          exitPrompt: '{{step.id}} done', prompt: 'line one {{item.id}}\n  indented: x\nlast\n',
        },
        { id: 'second', title: 'B', gate: 'auto', prompt: '{{item.title}}', model: 'opus', fork: 'a' },
        { id: 'third', title: 'C', gate: 'auto', prompt: 'no newline\nat the end', continue: 'second' },
        { id: 'fourth', title: 'D', gate: 'auto', prompt: ' leading and trailing space ' },
      ],
      doneStage: 'done',
    };
    const text = serializeWorkflowDefinition(def);
    expect(text).toMatch(/prompt: \|/);
    expect(parseWorkflowDefinition('x', text)).toEqual(def);
    expect(parse(text).steps[0].requires).toEqual(['plans/{{item.id}}.md']);
  });

  it('writes no stage or doneStage when absent', () => {
    const text = serializeWorkflowDefinition({ id: 'x', title: 'T', steps: [{ id: 'a', title: 'A', gate: 'auto', prompt: 'p' }] });
    expect(text).not.toMatch(/stage/i);
  });
});
