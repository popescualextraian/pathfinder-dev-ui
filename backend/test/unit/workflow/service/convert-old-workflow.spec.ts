import { convertOldWorkflowText } from '../../../../src/workflow/service/convert-old-workflow';
import { parseWorkflowDefinition } from '../../../../src/workflow/service/parse-workflow';

const OLD = `
# a comment
title: Plan, implement, review
steps:
  - id: plan
    title: Plan
    stage: plan
    sessions:
      - name: main
        prompt: |
          Plan #{{item.id}}
    gate: human
    exitPrompt: Finish the plan.
  - id: implement
    title: Implement
    requires:
      - "plans/{{item.id}}.md"
    sessions:
      - name: impl
        prompt: Implement it.
    gate: auto
  - id: review
    title: Review
    sessions:
      - name: review
        fork: impl
        model: sonnet
        prompt: Review it.
    gate: human
doneStage: done
`;

describe('convertOldWorkflowText', () => {
  it('turns the first session of each step into the step prompt, model and fork (fork names the step owning the session)', () => {
    const result = convertOldWorkflowText('wf', OLD);
    expect(result.kind).toBe('converted');
    if (result.kind !== 'converted') return;
    const def = parseWorkflowDefinition('wf', result.text);
    expect(def.steps.map((s) => s.id)).toEqual(['plan', 'implement', 'review']);
    expect(def.steps[0]).toMatchObject({ prompt: 'Plan #{{item.id}}\n', exitPrompt: 'Finish the plan.', gate: 'human' });
    expect(def.steps[1]).toMatchObject({ prompt: 'Implement it.', requires: ['plans/{{item.id}}.md'] });
    expect(def.steps[2]).toMatchObject({ fork: 'implement', model: 'sonnet', prompt: 'Review it.' });
    expect(def.doneStage).toBe('done');
    expect(result.text).not.toMatch(/sessions/);
  });

  it('leaves a file in the new format alone', () => {
    expect(convertOldWorkflowText('wf', 'title: T\nsteps:\n  - id: a\n    title: A\n    prompt: p\n    gate: auto\n').kind).toBe('unchanged');
  });

  it('refuses a step with more than one session, naming the step', () => {
    const text = OLD.replace('    gate: auto\n', "      - name: extra\n        prompt: more\n    gate: auto\n");
    const result = convertOldWorkflowText('wf', text);
    expect(result).toEqual({ kind: 'refused', error: expect.stringMatching(/step "implement" has 2 sessions/) });
  });

  it('refuses a fork of a session that is not in an earlier step, and invalid results', () => {
    expect(convertOldWorkflowText('wf', OLD.replace('fork: impl', 'fork: nope')).kind).toBe('refused');
    expect(convertOldWorkflowText('wf', 'title: [').kind).toBe('refused');
  });
});
