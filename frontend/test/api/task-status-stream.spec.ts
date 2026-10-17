import { openTaskStatusStream } from '../../src/api/task-status-stream';
import { FakeEventSource } from './fake-event-source';

describe('openTaskStatusStream', () => {
  beforeEach(() => FakeEventSource.install());

  it('connects to /api/tasks/stream and dispatches events', () => {
    const h = {
      onTask: jest.fn(),
      onRemoved: jest.fn(),
      onOpen: jest.fn(),
      onError: jest.fn(),
    };
    const close = openTaskStatusStream(h);
    const es = FakeEventSource.last;
    expect(es.url).toBe('/api/tasks/stream');

    es.emit('open');
    es.emit('task', { id: 'T-1' });
    es.emit('removed', { id: 'T-2' });
    es.emit('error');

    expect(h.onOpen).toHaveBeenCalledTimes(1);
    expect(h.onTask).toHaveBeenCalledWith({ id: 'T-1' });
    expect(h.onRemoved).toHaveBeenCalledWith('T-2');
    expect(h.onError).toHaveBeenCalledTimes(1);

    close();
    expect(es.closed).toBe(true);
  });

  it('reopens after a delay when the browser gave up (readyState CLOSED) and reports onOpen again', () => {
    jest.useFakeTimers();
    try {
      const h = { onTask: jest.fn(), onRemoved: jest.fn(), onOpen: jest.fn() };
      const close = openTaskStatusStream(h);
      const first = FakeEventSource.last;
      first.readyState = 2;
      first.emit('error');
      expect(FakeEventSource.instances).toHaveLength(1);
      jest.advanceTimersByTime(2100);
      expect(FakeEventSource.instances).toHaveLength(2);
      FakeEventSource.last.emit('open');
      expect(h.onOpen).toHaveBeenCalledTimes(1);
      close();
      expect(FakeEventSource.last.closed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not reopen while the browser is reconnecting itself, nor after close', () => {
    jest.useFakeTimers();
    try {
      const close = openTaskStatusStream({
        onTask: jest.fn(),
        onRemoved: jest.fn(),
      });
      FakeEventSource.last.emit('error'); // readyState CONNECTING/OPEN: EventSource retries itself
      jest.advanceTimersByTime(5000);
      expect(FakeEventSource.instances).toHaveLength(1);
      FakeEventSource.last.readyState = 2;
      FakeEventSource.last.emit('error');
      close();
      jest.advanceTimersByTime(5000);
      expect(FakeEventSource.instances).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
