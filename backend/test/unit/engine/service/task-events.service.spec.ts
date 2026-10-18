import { ConflictException, NotFoundException } from '@nestjs/common';
import { firstValueFrom, toArray } from 'rxjs';
import { BridgeEvent } from '../../../../src/engine/service/bridge-client';
import { TaskEventsService } from '../../../../src/engine/service/task-events.service';
import { fakeBridge, fakeRecords, record } from './helpers';

const ev = (seq: number) => ({ seq, type: 'state' }) as unknown as BridgeEvent;

describe('TaskEventsService', () => {
  it('streams bridge events and completes', async () => {
    const bridge = fakeBridge({ eventStream: jest.fn(async function* () { yield ev(1); yield ev(2); }) });
    const service = new TaskEventsService(fakeRecords([record()]) as never, (() => bridge) as never);
    const events = await firstValueFrom((await service.stream('T-20260101-abcd', 0)).pipe(toArray()));
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(bridge.eventStream).toHaveBeenCalledWith(0, expect.any(AbortSignal));
  });

  it('aborts the bridge stream on unsubscribe', async () => {
    let signal!: AbortSignal;
    const bridge = fakeBridge({
      eventStream: jest.fn(async function* (_since: number, s: AbortSignal) {
        signal = s;
        yield ev(1);
        await new Promise((resolve) => s.addEventListener('abort', resolve));
      }),
    });
    const service = new TaskEventsService(fakeRecords([record()]) as never, (() => bridge) as never);
    const seen: number[] = [];
    const sub = (await service.stream('T-20260101-abcd', 0)).subscribe((e) => seen.push(e.seq));
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([1]);
    sub.unsubscribe();
    expect(signal.aborted).toBe(true);
  });

  it('forwards stream errors', async () => {
    // eslint-disable-next-line require-yield
    const bridge = fakeBridge({ eventStream: jest.fn(async function* () { throw new Error('bad'); }) });
    const service = new TaskEventsService(fakeRecords([record()]) as never, (() => bridge) as never);
    await expect(firstValueFrom((await service.stream('T-20260101-abcd', 0)))).rejects.toThrow('bad');
  });

  it('refuses the stream of a closed task (409), before any bridge call', async () => {
    const bridge = fakeBridge();
    const service = new TaskEventsService(fakeRecords([record({ closed: true })]) as never, (() => bridge) as never);
    await expect(service.stream('T-20260101-abcd', 0)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.assertExists('T-20260101-abcd')).rejects.toBeInstanceOf(ConflictException);
    expect(bridge.eventStream).not.toHaveBeenCalled();
  });

  it('rejects an unknown task at call time', async () => {
    const service = new TaskEventsService(fakeRecords([]) as never, (() => fakeBridge()) as never);
    await expect(service.stream('T-20260101-abcd', 0)).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('assertExists', () => {
    it('resolves for a known task', async () => {
      const service = new TaskEventsService(fakeRecords([record()]) as never, (() => fakeBridge()) as never);
      await expect(service.assertExists('T-20260101-abcd')).resolves.toBeUndefined();
    });

    it('throws NotFoundException for an unknown or malformed id', async () => {
      const records = fakeRecords([record()]);
      const service = new TaskEventsService(records as never, (() => fakeBridge()) as never);
      await expect(service.assertExists('T-20260101-zzzz')).rejects.toThrow(NotFoundException);
      records.get.mockRejectedValueOnce(new Error('invalid id'));
      await expect(service.assertExists('../x')).rejects.toThrow(NotFoundException);
    });
  });
});
