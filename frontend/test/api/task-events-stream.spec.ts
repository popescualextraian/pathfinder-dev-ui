import { openTaskEventsStream } from '../../src/api/task-events-stream';
import { FakeEventSource } from './fake-event-source';

describe('openTaskEventsStream', () => {
  beforeEach(() => {
    FakeEventSource.install();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('delivers events and reconnects from the last seq after an error', () => {
    const onEvent = jest.fn();
    openTaskEventsStream('T-1', onEvent);
    const first = FakeEventSource.last;
    expect(first.url).toBe('/api/tasks/T-1/events/stream?since=0');

    first.emit('message', { seq: 1, type: 'state' });
    first.emit('message', { seq: 2, type: 'message' });
    expect(onEvent).toHaveBeenCalledTimes(2);

    first.emit('error');
    expect(first.closed).toBe(true);
    jest.advanceTimersByTime(5000);

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.last.url).toBe('/api/tasks/T-1/events/stream?since=2');
  });

  it('does not reconnect after close', () => {
    const close = openTaskEventsStream('T-1', jest.fn(), 5);
    expect(FakeEventSource.last.url).toContain('since=5');
    FakeEventSource.last.emit('error');
    close();
    jest.advanceTimersByTime(5000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
