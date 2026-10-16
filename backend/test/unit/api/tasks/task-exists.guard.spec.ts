import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { TaskExistsGuard } from '../../../../src/api/tasks/task-exists.guard';

const context = (id: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ params: { id } }) }) }) as unknown as ExecutionContext;

describe('TaskExistsGuard', () => {
  it('lets a known task through', async () => {
    const events = { assertExists: jest.fn().mockResolvedValue(undefined) };
    await expect(new TaskExistsGuard(events as never).canActivate(context('T-1'))).resolves.toBe(true);
    expect(events.assertExists).toHaveBeenCalledWith('T-1');
  });

  it('rejects an unknown task before the SSE stream starts', async () => {
    const events = { assertExists: jest.fn().mockRejectedValue(new NotFoundException()) };
    await expect(new TaskExistsGuard(events as never).canActivate(context('T-1'))).rejects.toThrow(NotFoundException);
  });
});
