import { act, fireEvent, render, screen } from '@testing-library/react';
import { FullRun } from '../../src/views/FullRun';
import { FakeEventSource } from '../api/fake-event-source';

const ev = (seq: number, type: string, data: Record<string, unknown>) => ({
  seq,
  ts: '2026-10-17T10:00:00Z',
  task: 'T-1',
  session: 's',
  agent: 'a',
  type,
  data,
});

describe('FullRun', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeEventSource.install();
  });
  afterEach(() => jest.useRealTimers());
  // events are applied in batches
  const flush = () => act(() => void jest.advanceTimersByTime(60));

  it('opens the stream from seq 0 and renders events in order without duplicates', () => {
    render(<FullRun taskId="T-1" />);
    expect(FakeEventSource.last.url).toBe('/api/tasks/T-1/events/stream?since=0');
    act(() => {
      FakeEventSource.last.emit('message', ev(2, 'message', { role: 'agent', text: 'second', final: true }));
      FakeEventSource.last.emit('message', ev(1, 'message', { role: 'user', text: 'first', final: true }));
      FakeEventSource.last.emit('message', ev(1, 'message', { role: 'user', text: 'first', final: true }));
      FakeEventSource.last.emit('message', ev(3, 'error', { message: 'boom' }));
    });
    flush();
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
    flush();
    expect(screen.getByText('Hello')).toBeTruthy();
    act(() => es.emit('message', ev(3, 'message', { role: 'agent', text: 'Hello world', final: true })));
    flush();
    expect(screen.queryByText('Hello')).toBeNull();
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('shows tool calls collapsed and expands them', () => {
    render(<FullRun taskId="T-1" />);
    act(() =>
      FakeEventSource.last.emit(
        'message',
        ev(1, 'tool', {
          id: 't',
          title: 'Run ls',
          kind: 'execute',
          status: 'completed',
          output_tail: 'file.txt',
        }),
      ),
    );
    flush();
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

  it('shows the note and opens no stream for a closed task', () => {
    render(<FullRun taskId="T-1" closed />);
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(screen.getByText(/Run not available/)).toBeTruthy();
  });

  it('stops retrying after 5 consecutive failures', () => {
    jest.useFakeTimers();
    try {
      render(<FullRun taskId="T-1" />);
      for (let i = 0; i < 8; i++) {
        act(() => FakeEventSource.last.emit('error'));
        act(() => void jest.advanceTimersByTime(2100));
      }
      expect(FakeEventSource.instances).toHaveLength(5);
      expect(screen.getByText(/Run not available/)).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders a real turn once and one row per tool id', () => {
    render(<FullRun taskId="T-1" />);
    const es = FakeEventSource.last;
    act(() => {
      es.emit('message', ev(1, 'message', { role: 'agent', text: 'Let me check', final: false }));
      es.emit(
        'message',
        ev(2, 'tool', {
          id: 't1',
          title: 'Run ls',
          kind: 'execute',
          status: 'pending',
        }),
      );
      es.emit(
        'message',
        ev(3, 'tool', {
          id: 't1',
          title: 'Run ls',
          kind: 'execute',
          status: 'completed',
        }),
      );
      es.emit('message', ev(4, 'message', { role: 'agent', text: ' Done.', final: false }));
      es.emit(
        'message',
        ev(5, 'message', {
          role: 'agent',
          text: 'Let me check Done.',
          final: true,
        }),
      );
    });
    flush();
    expect(screen.getAllByText('Let me check Done.')).toHaveLength(1);
    expect(screen.getAllByText('Run ls')).toHaveLength(1);
    expect(screen.getByText(/completed/)).toBeTruthy();
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
