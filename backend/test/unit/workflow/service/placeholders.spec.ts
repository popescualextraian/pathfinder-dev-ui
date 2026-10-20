import { fillPlaceholders } from '../../../../src/workflow/service/placeholders';

describe('fillPlaceholders', () => {
  const ctx = {
    item: { id: '7', title: 'Seven', description: 'Desc', url: 'https://x/7', stage: 'todo' },
    step: { id: 'plan' },
    task: { id: 'T-1', branch: 'agentic/T-1' },
  };

  it('fills every placeholder, with or without spaces inside the braces', () => {
    expect(fillPlaceholders('{{item.id}} {{ item.title }} {{item.description}} {{item.url}} {{task.id}} {{task.branch}} {{step.id}}', ctx))
      .toBe('7 Seven Desc https://x/7 T-1 agentic/T-1 plan');
  });

  it('fills an unknown task with empty strings and leaves other text alone', () => {
    expect(fillPlaceholders('[{{task.id}}][{{task.branch}}] {not} {{', { ...ctx, task: undefined })).toBe('[][] {not} {{');
  });

  it('does not re-expand placeholders inside filled values', () => {
    expect(fillPlaceholders('{{item.title}}', { ...ctx, item: { ...ctx.item, title: '{{item.id}}' } })).toBe('{{item.id}}');
  });
});
