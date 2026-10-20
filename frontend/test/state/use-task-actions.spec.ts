import { act, renderHook } from '@testing-library/react';
import { useTaskActions } from '../../src/state/use-task-actions';
import * as api from '../../src/api/tasks-api';
import { makeTask } from '../fixtures/tasks';

jest.mock('../../src/api/tasks-api');
const mocked = jest.mocked(api);

describe('useTaskActions sessions', () => {
  beforeEach(() => jest.resetAllMocks());

  it('passes the session to prompt, answer and cancel', async () => {
    const task = makeTask();
    mocked.sendPrompt.mockResolvedValue(task);
    mocked.answer.mockResolvedValue(task);
    mocked.cancel.mockResolvedValue(task);
    const onTask = jest.fn();
    const { result } = renderHook(() => useTaskActions('T-1', onTask, 'second'));
    await act(async () => {
      await result.current.prompt.run('hi');
      await result.current.answer.run('yes', 'q1');
      await result.current.cancel.run();
    });
    expect(mocked.sendPrompt).toHaveBeenCalledWith('T-1', 'hi', 'second');
    expect(mocked.answer).toHaveBeenCalledWith('T-1', {
      text: 'yes',
      question: 'q1',
      session: 'second',
    });
    expect(mocked.cancel).toHaveBeenCalledWith('T-1', 'second');
    expect(onTask).toHaveBeenCalledTimes(3);
  });

  it('adds a session with pending and error state', async () => {
    const task = makeTask();
    mocked.addSession.mockRejectedValueOnce(new Error('name taken')).mockResolvedValueOnce(task);
    const onTask = jest.fn();
    const { result } = renderHook(() => useTaskActions('T-1', onTask));
    let res: { ok: boolean } | undefined;
    await act(async () => {
      res = await result.current.addSession.run({ name: 'second' });
    });
    expect(res?.ok).toBe(false);
    expect(result.current.addSession.error).toBe('name taken');
    expect(result.current.addSession.pending).toBe(false);
    await act(async () => {
      res = await result.current.addSession.run({
        name: 'third',
        forkFrom: 'main',
      });
    });
    expect(res?.ok).toBe(true);
    expect(result.current.addSession.error).toBeNull();
    expect(mocked.addSession).toHaveBeenLastCalledWith('T-1', {
      name: 'third',
      forkFrom: 'main',
    });
    expect(onTask).toHaveBeenCalledWith(task);
  });
});
