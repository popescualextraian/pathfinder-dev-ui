import { checkDraft } from '../../../../../src/workflow/service/generator/check-draft';

const VALID = `title: Plan and do
steps:
  - id: plan
    title: Plan
    stage: plan
    gate: human
    prompt: Plan {{item.title}}
  - id: do
    title: Do
    gate: auto
    continue: plan
    prompt: Do it on {{task.branch}}
`;

describe('checkDraft', () => {
  it('accepts a valid draft and returns the normalized definition', () => {
    const result = checkDraft(`${VALID}extra: dropped\n`, ['plan', 'done']);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.definition.title).toBe('Plan and do');
    expect(result.definition.steps.map((s) => s.id)).toEqual(['plan', 'do']);
    expect(result.definition).not.toHaveProperty('extra');
  });

  it('reports a missing file', () => {
    expect(checkDraft(null)).toEqual({ valid: false, errors: [{ message: expect.stringMatching(/workflow-draft\.yaml was not found/) }] });
  });

  it('reports YAML that does not parse, without a draft', () => {
    const result = checkDraft('title: [unclosed\n');
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/^invalid YAML: /);
    expect(result.draft).toBeUndefined();
  });

  it('reports the first rule broken with its location and keeps the parsed draft', () => {
    const result = checkDraft(VALID.replace('stage: plan', 'stage: nowhere'), ['plan', 'done']);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors).toEqual([{ message: expect.stringContaining('"nowhere" is not a stage'), stepId: 'plan', field: 'stage' }]);
    expect(result.draft).toMatchObject({ title: 'Plan and do', steps: [{ id: 'plan', stage: 'nowhere' }, { id: 'do' }] });
  });

  it('keeps no draft when the document is not a mapping', () => {
    const result = checkDraft('- just\n- a list\n');
    expect(result).toEqual({ valid: false, errors: [{ message: 'the document must be a mapping' }] });
  });
});
