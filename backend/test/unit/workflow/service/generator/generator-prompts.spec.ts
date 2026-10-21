import { changesPrompt, fixPrompt } from '../../../../../src/workflow/service/generator/generator-prompts';

describe('generator prompts', () => {
  describe('fixPrompt', () => {
    it('lists every error with where it is', () => {
      const text = fixPrompt([
        { message: 'steps[1].continue "x" is not an earlier step', stepId: 'review', field: 'continue' },
        { message: 'steps[0].id must be a non-empty string', stepIndex: 0, field: 'id' },
        { message: 'title must be a non-empty string', field: 'title' },
        { message: 'invalid YAML: bad indentation' },
      ], 1, 2);
      expect(text).toContain('- step "review", field `continue`: steps[1].continue "x" is not an earlier step');
      expect(text).toContain('- step 1, field `id`: steps[0].id must be a non-empty string');
      expect(text).toContain('- field `title`: title must be a non-empty string');
      expect(text).toContain('- invalid YAML: bad indentation');
    });

    it('tells the agent to correct workflow-draft.yaml in place and finish with a short note', () => {
      const text = fixPrompt([{ message: 'workflow-draft.yaml was not found' }], 2, 2);
      expect(text).toMatch(/correct `workflow-draft\.yaml` in place/i);
      expect(text).toMatch(/root of your worktree/);
      expect(text).toMatch(/short note/);
      expect(text).toContain('fix 2 of 2');
    });
  });

  describe('changesPrompt', () => {
    it('passes the text on unchanged and reminds that the file must be rewritten', () => {
      const ask = 'Add a test step after implement.\n$& {{item.id}} stays as written';
      const text = changesPrompt(ask);
      expect(text).toContain(ask);
      expect(text).toMatch(/rewrite `workflow-draft\.yaml`/i);
      expect(text).toMatch(/short note/);
      expect(text.indexOf(ask)).toBeLessThan(text.indexOf('Rewrite'));
    });
  });
});
