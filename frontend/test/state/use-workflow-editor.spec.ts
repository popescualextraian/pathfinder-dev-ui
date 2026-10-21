import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '../../src/api/http';
import type { WorkflowDefinition } from '../../src/api/models';
import * as api from '../../src/api/workflows-api';
import { useWorkflowEditor, VALIDATE_DELAY_MS } from '../../src/state/use-workflow-editor';
import { addStep, setConversation, updateStep } from '../../src/state/workflow-draft';

jest.mock('../../src/api/workflows-api');
const m = (f: unknown) => f as jest.Mock;

const stored = (over: Partial<WorkflowDefinition> = {}) => ({
  definition: {
    id: 'wf',
    title: 'WF',
    steps: [{ id: 'plan', title: 'Plan', gate: 'human', prompt: 'go' }],
    ...over,
  },
  version: 'v1',
});

beforeEach(() => {
  jest.resetAllMocks();
  m(api.validateWorkflow).mockResolvedValue([]);
});

const edit = async (options?: { writable?: boolean }) => {
  m(api.readWorkflow).mockResolvedValue(stored());
  const hook = renderHook(() => useWorkflowEditor({ kind: 'edit', id: 'wf' }, options));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};

describe('useWorkflowEditor', () => {
  it('loads an existing workflow: clean, version, id fixed', async () => {
    const { result } = await edit();
    expect(api.readWorkflow).toHaveBeenCalledWith('wf');
    expect(result.current).toMatchObject({ id: 'wf', isNew: false, dirty: false, version: 'v1', canSave: false });
    expect(result.current.draft.title).toBe('WF');
    expect('id' in result.current.draft).toBe(false);
  });

  it('edits steps without sessions: the id follows the title and the continuing step follows the id', async () => {
    const { result } = await edit();
    act(() => result.current.setDraft((d) => updateStep(addStep(d), 1, { title: 'Build', prompt: 'build', model: 'opus' })));
    act(() => result.current.setDraft((d) => setConversation(d, 1, { kind: 'continue', step: 'plan' })));
    expect(result.current.draft.steps[1]).toEqual({ id: 'build', title: 'Build', gate: 'human', prompt: 'build', continue: 'plan' });
    act(() => result.current.setDraft((d) => updateStep(d, 0, { title: 'Design' })));
    expect(result.current.draft.steps.map((s) => [s.id, s.continue])).toEqual([['design', undefined], ['build', 'design']]);
    m(api.updateWorkflow).mockImplementation((id, definition) => Promise.resolve({ definition: { id, ...definition }, version: 'v2' }));
    await act(async () => {
      await result.current.save();
    });
    expect(m(api.updateWorkflow).mock.calls[0][1].steps).toEqual([
      { id: 'design', title: 'Design', gate: 'human', prompt: 'go' },
      { id: 'build', title: 'Build', gate: 'human', prompt: 'build', continue: 'design' },
    ]);
  });

  it('shows a load failure', async () => {
    m(api.readWorkflow).mockRejectedValue(new ApiError(404, 'not found'));
    const { result } = renderHook(() => useWorkflowEditor({ kind: 'edit', id: 'x' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe('not found');
  });

  it('a new workflow starts with one step, proposes the id from the title until it is typed', () => {
    const { result } = renderHook(() => useWorkflowEditor({ kind: 'new' }));
    expect(result.current).toMatchObject({ isNew: true, dirty: false, version: null, id: '', canSave: false });
    act(() => result.current.setTitle('My Flow'));
    expect(result.current.id).toBe('my-flow');
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setId('custom'));
    act(() => result.current.setTitle('Other'));
    expect(result.current.id).toBe('custom');
    expect(result.current.canSave).toBe(true);
  });

  it('a duplicate starts from a copy of the definition as a new, dirty-free draft', async () => {
    m(api.readWorkflow).mockResolvedValue(stored());
    const { result } = renderHook(() => useWorkflowEditor({ kind: 'duplicate', id: 'wf' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ isNew: true, version: null, id: 'wf-copy', dirty: false });
    expect(result.current.draft.title).toBe('WF (copy)');
  });

  it('dirty follows the draft and clears when it is edited back', async () => {
    const { result } = await edit();
    act(() => result.current.setDraft((d) => updateStep(d, 0, { title: 'Plan 2' })));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setDraft((d) => updateStep(d, 0, { title: 'Plan' })));
    expect(result.current.dirty).toBe(false);
  });

  it('validates after a pause and shows the first error with its location', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await edit();
      m(api.validateWorkflow).mockResolvedValue([{ message: 'empty prompt', stepId: 'plan', field: 'prompt' }]);
      act(() => result.current.setDraft((d) => addStep(d)));
      act(() => result.current.setDraft((d) => updateStep(d, 0, { title: 'P' })));
      expect(api.validateWorkflow).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(VALIDATE_DELAY_MS);
      });
      expect(api.validateWorkflow).toHaveBeenCalledTimes(1);
      expect(result.current.validationError).toEqual({ message: 'empty prompt', stepId: 'plan', field: 'prompt' });
      expect(result.current.canSave).toBe(false);
      m(api.validateWorkflow).mockResolvedValue([]);
      act(() => result.current.setDraft((d) => updateStep(d, 0, { title: 'Q' })));
      expect(result.current.validationError).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('save updates with the version, cleans the dirty flag and takes the new version', async () => {
    const { result } = await edit();
    act(() => result.current.setDraft((d) => updateStep(d, 0, { title: 'Plan 2', stage: '' })));
    m(api.updateWorkflow).mockResolvedValue({ ...stored({ title: 'WF' }), version: 'v2' });
    let ok = false;
    await act(async () => {
      ok = await result.current.save();
    });
    expect(ok).toBe(true);
    expect(api.validateWorkflow).toHaveBeenCalled();
    const [id, def, version] = m(api.updateWorkflow).mock.calls[0];
    expect([id, version]).toEqual(['wf', 'v1']);
    expect(def.steps[0]).not.toHaveProperty('stage');
    expect(def.steps[0].title).toBe('Plan 2');
    expect(result.current).toMatchObject({ version: 'v2', saving: false, conflict: null });
    expect(api.createWorkflow).not.toHaveBeenCalled();
  });

  it('save of a new workflow creates, then updates with the returned version', async () => {
    const { result } = renderHook(() => useWorkflowEditor({ kind: 'new' }));
    act(() => result.current.setTitle('Flow'));
    act(() => result.current.setDraft((d) => updateStep(d, 0, { title: 'Plan' })));
    m(api.createWorkflow).mockImplementation((id, definition) => Promise.resolve({ definition: { id, ...definition }, version: 'v1' }));
    await act(async () => {
      await result.current.save();
    });
    expect(m(api.createWorkflow).mock.calls[0][0]).toBe('flow');
    expect(result.current).toMatchObject({ isNew: false, version: 'v1', dirty: false });
    act(() => result.current.setTitle('Flow 2'));
    m(api.updateWorkflow).mockResolvedValue({ ...stored(), version: 'v2' });
    await act(async () => {
      await result.current.save();
    });
    expect(api.updateWorkflow).toHaveBeenCalledWith('flow', expect.anything(), 'v1');
  });

  it('save checks first; an error from the check stops the write and shows at its place', async () => {
    const { result } = await edit();
    act(() => result.current.setTitle('x'));
    m(api.validateWorkflow).mockResolvedValue([{ message: 'bad', stepId: 'plan' }]);
    let ok = true;
    await act(async () => {
      ok = await result.current.save();
    });
    expect(ok).toBe(false);
    expect(api.updateWorkflow).not.toHaveBeenCalled();
    expect(result.current.validationError).toEqual({ message: 'bad', stepId: 'plan' });
  });

  it('a 400 with a location of the save becomes the validation error', async () => {
    const { result } = await edit();
    act(() => result.current.setTitle('x'));
    m(api.updateWorkflow).mockRejectedValue(new ApiError(400, 'unknown stage', { stepId: 'plan', field: 'stage' }));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.validationError).toEqual({ message: 'unknown stage', stepId: 'plan', field: 'stage' });
  });

  it('409 sets conflict and keeps the draft; reload drops it and clears the conflict', async () => {
    const { result } = await edit();
    act(() => result.current.setTitle('mine'));
    m(api.updateWorkflow).mockRejectedValue(new ApiError(409, 'changed on disk'));
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.conflict).toBe('changed on disk');
    expect(result.current.draft.title).toBe('mine');
    m(api.readWorkflow).mockResolvedValue({ ...stored({ title: 'theirs' }), version: 'v9' });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current).toMatchObject({ conflict: null, version: 'v9', dirty: false });
    expect(result.current.draft.title).toBe('theirs');
  });

  it('overwrite reads the current version and saves over it', async () => {
    const { result } = await edit();
    act(() => result.current.setTitle('mine'));
    m(api.updateWorkflow).mockRejectedValueOnce(new ApiError(409, 'changed'));
    await act(async () => {
      await result.current.save();
    });
    m(api.readWorkflow).mockResolvedValue({ ...stored(), version: 'v9' });
    m(api.updateWorkflow).mockResolvedValue({ ...stored({ title: 'mine' }), version: 'v10' });
    await act(async () => {
      expect(await result.current.overwrite()).toBe(true);
    });
    expect(m(api.updateWorkflow).mock.calls[1][2]).toBe('v9');
    expect(result.current).toMatchObject({ conflict: null, version: 'v10' });
  });

  it('create with an existing id is a conflict', async () => {
    const { result } = renderHook(() => useWorkflowEditor({ kind: 'new' }));
    act(() => result.current.setTitle('Flow'));
    m(api.createWorkflow).mockRejectedValue(new ApiError(409, 'exists'));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.conflict).toBe('exists');
  });

  it('read-only: given, or learned from a 403 on save; save is not offered', async () => {
    const given = await edit({ writable: false });
    act(() => given.result.current.setTitle('x'));
    expect(given.result.current).toMatchObject({ readOnly: true, canSave: false });

    const { result } = await edit();
    act(() => result.current.setTitle('x'));
    expect(result.current.canSave).toBe(true);
    m(api.updateWorkflow).mockRejectedValue(new ApiError(403, 'read-only'));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current).toMatchObject({ readOnly: true, canSave: false });
  });

  it('other save failures are shown as saveError; discard restores the loaded draft', async () => {
    const { result } = await edit();
    act(() => result.current.setTitle('x'));
    m(api.updateWorkflow).mockRejectedValue(new ApiError(500, 'boom'));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.saveError).toBe('boom');
    act(() => result.current.discard());
    expect(result.current).toMatchObject({ dirty: false, saveError: null });
    expect(result.current.draft.title).toBe('WF');
  });
});
