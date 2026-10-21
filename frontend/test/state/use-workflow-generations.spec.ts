import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '../../src/api/http';
import type { WorkflowGenerationSummary, WorkflowGenerationView } from '../../src/api/models';
import { GENERATION_POLL_MS, isActiveGeneration, markGenerationSavedQuietly, useWorkflowGenerations } from '../../src/state/use-workflow-generations';
import * as api from '../../src/api/workflows-api';
import * as tasks from '../../src/api/tasks-api';

jest.mock('../../src/api/workflows-api');
jest.mock('../../src/api/tasks-api');
const m = (f: unknown) => f as jest.Mock;

const gen = (over: Partial<WorkflowGenerationSummary> = {}): WorkflowGenerationSummary => ({
  id: 'G-1', taskId: 'T-1', description: 'd', state: 'ready', attempts: 0, hasDraft: true,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
});
const view = (over: Partial<WorkflowGenerationView> = {}): WorkflowGenerationView => {
  const { hasDraft: _h, ...rest } = gen();
  return { ...rest, draft: { title: 't' }, ...over } as WorkflowGenerationView;
};

describe('useWorkflowGenerations', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  const tick = async (ms = GENERATION_POLL_MS) => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  };
  const mount = async (initial: WorkflowGenerationSummary[]) => {
    m(api.listGenerations).mockResolvedValue(initial);
    const hook = renderHook(() => useWorkflowGenerations());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  };

  it('isActiveGeneration is true for writing, asking, fixing', () => {
    expect((['writing', 'asking', 'fixing', 'ready', 'failed'] as const).map((state) => isActiveGeneration({ state }))).toEqual([
      true, true, true, false, false,
    ]);
  });

  it('lists once and does not poll while nothing is active', async () => {
    const { result } = await mount([gen(), gen({ id: 'G-2', state: 'failed' })]);
    expect(result.current.generations.map((g) => g.id)).toEqual(['G-1', 'G-2']);
    await tick(GENERATION_POLL_MS * 3);
    expect(api.listGenerations).toHaveBeenCalledTimes(1);
  });

  it('polls while one is active and stops when none is', async () => {
    const { result } = await mount([gen({ state: 'writing' })]);
    m(api.listGenerations).mockResolvedValue([gen({ state: 'fixing', attempts: 1 })]);
    await tick();
    expect(api.listGenerations).toHaveBeenCalledTimes(2);
    expect(result.current.generations[0].state).toBe('fixing');
    m(api.listGenerations).mockResolvedValue([gen({ state: 'ready' })]);
    await tick();
    expect(api.listGenerations).toHaveBeenCalledTimes(3);
    await tick(GENERATION_POLL_MS * 3);
    expect(api.listGenerations).toHaveBeenCalledTimes(3);
  });

  it('stops polling on unmount', async () => {
    const { unmount } = await mount([gen({ state: 'writing' })]);
    unmount();
    await tick(GENERATION_POLL_MS * 3);
    expect(api.listGenerations).toHaveBeenCalledTimes(1);
  });

  it('keeps the list and shows the error when a poll fails', async () => {
    const { result } = await mount([gen({ state: 'writing' })]);
    m(api.listGenerations).mockRejectedValue(new Error('down'));
    await tick();
    expect(result.current.error).toBe('down');
    expect(result.current.generations).toHaveLength(1);
    m(api.listGenerations).mockResolvedValue([gen({ state: 'writing' })]);
    await tick();
    expect(result.current.error).toBeNull();
  });

  it('start adds the generation (without draft) and begins polling', async () => {
    const { result } = await mount([]);
    m(api.startGeneration).mockResolvedValue(view({ id: 'G-9', state: 'writing', draft: undefined }));
    let out: { ok: boolean } | undefined;
    await act(async () => {
      out = await result.current.start('do it', 'opus');
    });
    expect(out?.ok).toBe(true);
    expect(api.startGeneration).toHaveBeenCalledWith('do it', 'opus');
    expect(result.current.generations.map((g) => g.id)).toEqual(['G-9']);
    expect(result.current.generations[0]).toMatchObject({ hasDraft: false });
    expect(result.current.generations[0]).not.toHaveProperty('draft');
    m(api.listGenerations).mockResolvedValue([gen({ id: 'G-9', state: 'ready' })]);
    await tick();
    expect(result.current.generations[0].state).toBe('ready');
  });

  it('start failure sets the start error, 403 as read-only message', async () => {
    const { result } = await mount([]);
    m(api.startGeneration).mockRejectedValue(new ApiError(403, 'Forbidden'));
    await act(async () => {
      expect((await result.current.start('x')).ok).toBe(false);
    });
    expect(result.current.startState.error).toMatch(/read-only/i);
    expect(result.current.startState.pending).toBe(false);
    expect(result.current.generations).toEqual([]);
  });

  it('start reports pending while it runs', async () => {
    const { result } = await mount([]);
    let resolve!: (v: WorkflowGenerationView) => void;
    m(api.startGeneration).mockReturnValue(new Promise((r) => (resolve = r)));
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.start('x');
    });
    expect(result.current.startState.pending).toBe(true);
    await act(async () => {
      resolve(view({ state: 'writing' }));
      await p;
    });
    expect(result.current.startState.pending).toBe(false);
  });

  it('requestChanges replaces the generation with the returned state and polls', async () => {
    const { result } = await mount([gen()]);
    m(api.requestGenerationChanges).mockResolvedValue(view({ state: 'writing', draft: undefined }));
    await act(async () => {
      expect((await result.current.requestChanges('G-1', 'more')).ok).toBe(true);
    });
    expect(api.requestGenerationChanges).toHaveBeenCalledWith('G-1', 'more');
    expect(result.current.generations[0]).toMatchObject({ state: 'writing', hasDraft: false });
    m(api.listGenerations).mockResolvedValue([gen({ state: 'ready' })]);
    await tick();
    expect(result.current.generations[0].state).toBe('ready');
  });

  it('a failed action keeps the generation, sets its error, then reloads it', async () => {
    const { result } = await mount([gen()]);
    m(api.requestGenerationChanges).mockRejectedValue(new ApiError(409, 'not ready'));
    await act(async () => {
      expect((await result.current.requestChanges('G-1', 'x')).ok).toBe(false);
    });
    expect(result.current.actionState('G-1')).toEqual({ pending: false, error: 'not ready' });
    expect(result.current.actionState('other')).toEqual({ pending: false, error: null });
    expect(result.current.generations[0].state).toBe('ready');
    expect(api.listGenerations).toHaveBeenCalledTimes(2);
  });

  it('discard removes the generation from the list', async () => {
    const { result } = await mount([gen(), gen({ id: 'G-2' })]);
    m(api.discardGeneration).mockResolvedValue(view({ state: 'discarded' }));
    await act(async () => {
      expect((await result.current.discard('G-1')).ok).toBe(true);
    });
    expect(result.current.generations.map((g) => g.id)).toEqual(['G-2']);
  });

  it('403 on an action shows the read-only message', async () => {
    const { result } = await mount([gen()]);
    m(api.discardGeneration).mockRejectedValue(new ApiError(403, 'no'));
    await act(async () => {
      await result.current.discard('G-1');
    });
    expect(result.current.actionState('G-1').error).toMatch(/read-only/i);
  });

  it('answer uses the task answer API with the question id and session, then reloads', async () => {
    const question = { id: 'Q-1', session: 'main', text: 'which?', options: ['a', 'b'], asked: 'x' };
    const { result } = await mount([gen({ state: 'asking', question })]);
    m(tasks.answer).mockResolvedValue({});
    m(api.listGenerations).mockResolvedValue([gen({ state: 'writing' })]);
    await act(async () => {
      expect((await result.current.answer(result.current.generations[0], 'a')).ok).toBe(true);
    });
    expect(tasks.answer).toHaveBeenCalledWith('T-1', { text: 'a', question: 'Q-1', session: 'main' });
    expect(result.current.generations[0].state).toBe('writing');
  });

  it('answer without an open question fails with a message', async () => {
    const { result } = await mount([gen()]);
    await act(async () => {
      expect((await result.current.answer(result.current.generations[0], 'a')).ok).toBe(false);
    });
    expect(tasks.answer).not.toHaveBeenCalled();
    expect(result.current.actionState('G-1').error).toBeTruthy();
  });

  it('reload loads again', async () => {
    const { result } = await mount([gen()]);
    m(api.listGenerations).mockResolvedValue([gen(), gen({ id: 'G-2' })]);
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.generations).toHaveLength(2);
  });
});

describe('markGenerationSavedQuietly', () => {
  beforeEach(() => jest.resetAllMocks());

  it('resolves null when marked', async () => {
    m(api.markGenerationSaved).mockResolvedValue(view({ state: 'saved' }));
    await expect(markGenerationSavedQuietly('G-1')).resolves.toBeNull();
    expect(api.markGenerationSaved).toHaveBeenCalledWith('G-1');
  });

  it('never rejects: a failure becomes a notice', async () => {
    m(api.markGenerationSaved).mockRejectedValue(new Error('boom'));
    await expect(markGenerationSavedQuietly('G-1')).resolves.toBe(
      'The workflow is saved, but its generation could not be closed (boom). Discard it on the Workflows page.',
    );
  });
});
