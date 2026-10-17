import { openTaskStatusStream } from '../../src/api/task-status-stream';
import { FakeEventSource } from './fake-event-source';

describe('openTaskStatusStream', () => {
  beforeEach(() => FakeEventSource.install());

  it('connects to /api/tasks/stream and dispatches events', () => {
    const h = { onTask: jest.fn(), onRemoved: jest.fn(), onOpen: jest.fn(), onError: jest.fn() };
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
});
