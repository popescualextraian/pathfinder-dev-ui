import { act, fireEvent, render, screen } from '@testing-library/react';
import { FullRun } from '../../src/views/FullRun';
import { FakeEventSource } from '../api/fake-event-source';

const ev = (seq: number, type: string, data: Record<string, unknown>) => ({
  seq, ts: '2026-10-17T10:00:00Z', task: 'T-1', session: 's', agent: 'a', type, data,
});

describe('FullRun', () => {
  beforeEach(() => FakeEventSource.install());

  it('opens the stream from seq 0 and renders events in order without duplicates', () => {
    render(<FullRun taskId="T-1" />);
    expect(FakeEventSource.last.url).toBe('/api/tasks/T-1/events/stream?since=0');
    act(() => {
      FakeEventSource.last.emit('message', ev(2, 'message', { role: 'agent', text: 'second', final: true }));
      FakeEventSource.last.emit('message', ev(1, 'message', { role: 'user', text: 'first', final: true }));
      FakeEventSource.last.emit('message', ev(1, 'message', { role: 'user', text: 'first', final: true }));
      FakeEventSource.last.emit('message', ev(3, 'error', { message: 'boom' }));
    });
    const text = screen.getByTestId('full-run').textContent ?? '';
    expect(text.indexOf('first')).toBeLessThan(text.indexOf('second'));
    expect(text.indexOf('second')).toBeLessThan(text.indexOf('boom'));
    expect(screen.getAllByText('first')).toHaveLength(1);
  });

  it('merges chunks and replaces them by the final message', () => {
    render(<FullRun taskId="T-1" />);
    const es = FakeEventSource.last;
    act(() => {
      es.emit('message', ev(1, 'message', { role: 'agent', text: 'Hel', final: false }));
      es.emit('message', ev(2, 'message', { role: 'agent', text: 'lo', final: false }));
    });
    expect(screen.getByText('Hello')).toBeTruthy();
    act(() => es.emit('message', ev(3, 'message', { role: 'agent', text: 'Hello world', final: true })));
    expect(screen.queryByText('Hello')).toBeNull();
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('shows tool calls collapsed and expands them', () => {
    render(<FullRun taskId="T-1" />);
    act(() =>
      FakeEventSource.last.emit('message', ev(1, 'tool', { id: 't', title: 'Run ls', kind: 'execute', status: 'completed', output_tail: 'file.txt' })),
    );
    expect(screen.getByText('Run ls')).toBeTruthy();
    expect(screen.queryByText('file.txt')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Run ls/ }));
    expect(screen.getByText('file.txt')).toBeTruthy();
  });

  it('shows a note when the stream fails', () => {
    render(<FullRun taskId="T-1" />);
    act(() => FakeEventSource.last.emit('error'));
    expect(screen.getByText('Run not available (container not running)')).toBeTruthy();
  });

  it('closes the stream on unmount', () => {
    const { unmount } = render(<FullRun taskId="T-1" />);
    const es = FakeEventSource.last;
    unmount();
    expect(es.closed).toBe(true);
  });

  it('reopens for another task and closes the old stream', () => {
    const { rerender } = render(<FullRun taskId="T-1" />);
    const first = FakeEventSource.last;
    rerender(<FullRun taskId="T-2" />);
    expect(first.closed).toBe(true);
    expect(FakeEventSource.last.url).toContain('/T-2/');
  });
});
