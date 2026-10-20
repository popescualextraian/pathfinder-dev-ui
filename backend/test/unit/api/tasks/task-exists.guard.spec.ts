import { BadRequestException, ExecutionContext, NotFoundException } from '@nestjs/common';
import { TaskExistsGuard } from '../../../../src/api/tasks/task-exists.guard';

const context = (id: string, query: Record<string, unknown> = {}) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ params: { id }, query }) }) }) as unknown as ExecutionContext;

describe('TaskExistsGuard', () => {
  it('lets a known task through', async () => {
    const events = { assertExists: jest.fn().mockResolvedValue(undefined) };
    await expect(new TaskExistsGuard(events as never).canActivate(context('T-1'))).resolves.toBe(true);
    expect(events.assertExists).toHaveBeenCalledWith('T-1');
  });

  it('passes a valid session on, and rejects a bad name with 400 without asking', async () => {
    const events = { assertExists: jest.fn().mockResolvedValue(undefined) };
    const guard = new TaskExistsGuard(events as never);
    await guard.canActivate(context('T-1', { session: 'second' }));
    expect(events.assertExists).toHaveBeenCalledWith('T-1', 'second');
    events.assertExists.mockClear();
    for (const session of ['Bad', '', '-x', 'a'.repeat(33), ['a', 'b']]) {
      await expect(guard.canActivate(context('T-1', { session }))).rejects.toThrow(BadRequestException);
    }
    expect(events.assertExists).not.toHaveBeenCalled();
  });

  it('rejects an unknown task before the SSE stream starts', async () => {
    const events = { assertExists: jest.fn().mockRejectedValue(new NotFoundException()) };
    await expect(new TaskExistsGuard(events as never).canActivate(context('T-1'))).rejects.toThrow(NotFoundException);
  });
});
