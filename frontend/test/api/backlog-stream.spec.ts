import { openBacklogStream } from '../../src/api/backlog-stream';
import { FakeEventSource } from './fake-event-source';

describe('openBacklogStream', () => {
  beforeEach(() => FakeEventSource.install());

  it('connects to /api/backlog/stream and dispatches events', () => {
    const h = { onItem: jest.fn(), onRemoved: jest.fn(), onOpen: jest.fn() };
    const close = openBacklogStream(h);
    const es = FakeEventSource.last;
    expect(es.url).toBe('/api/backlog/stream');
    es.emit('open');
    es.emit('item', { id: '1' });
    es.emit('removed', { id: '2' });
    expect(h.onOpen).toHaveBeenCalledTimes(1);
    expect(h.onItem).toHaveBeenCalledWith({ id: '1' });
    expect(h.onRemoved).toHaveBeenCalledWith('2');
    close();
    expect(es.closed).toBe(true);
  });

  it('treats an error MessageEvent with data as a server message, not a connection error', () => {
    const h = { onItem: jest.fn(), onRemoved: jest.fn(), onError: jest.fn(), onServerError: jest.fn() };
    openBacklogStream(h);
    FakeEventSource.last.emit('error', { message: 'source down' });
    expect(h.onServerError).toHaveBeenCalledWith('source down');
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('treats an error without data as a connection error and reopens after CLOSED', () => {
    jest.useFakeTimers();
    try {
      const h = { onItem: jest.fn(), onRemoved: jest.fn(), onError: jest.fn(), onServerError: jest.fn() };
      const close = openBacklogStream(h);
      FakeEventSource.last.emit('error');
      expect(h.onError).toHaveBeenCalledTimes(1);
      expect(h.onServerError).not.toHaveBeenCalled();
      expect(FakeEventSource.instances).toHaveLength(1);
      FakeEventSource.last.readyState = 2;
      FakeEventSource.last.emit('error');
      jest.advanceTimersByTime(2100);
      expect(FakeEventSource.instances).toHaveLength(2);
      close();
      jest.advanceTimersByTime(5000);
      expect(FakeEventSource.instances).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
