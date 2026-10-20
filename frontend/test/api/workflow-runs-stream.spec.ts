import { openWorkflowRunsStream } from '../../src/api/workflow-runs-stream';
import { FakeEventSource } from './fake-event-source';

describe('openWorkflowRunsStream', () => {
  beforeEach(() => FakeEventSource.install());

  it('connects to /api/workflow-runs/stream and dispatches run and open', () => {
    const h = { onRun: jest.fn(), onOpen: jest.fn() };
    const close = openWorkflowRunsStream(h);
    const es = FakeEventSource.last;
    expect(es.url).toBe('/api/workflow-runs/stream');
    es.emit('open');
    es.emit('run', { id: 'R-1' });
    expect(h.onOpen).toHaveBeenCalledTimes(1);
    expect(h.onRun).toHaveBeenCalledWith({ id: 'R-1' });
    close();
    expect(es.closed).toBe(true);
  });

  it('reports errors and reopens after CLOSED until closed', () => {
    jest.useFakeTimers();
    try {
      const h = { onRun: jest.fn(), onError: jest.fn() };
      const close = openWorkflowRunsStream(h);
      FakeEventSource.last.emit('error');
      expect(h.onError).toHaveBeenCalledTimes(1);
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
