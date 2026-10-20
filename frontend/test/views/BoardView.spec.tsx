import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { BoardView } from '../../src/views/BoardView';
import { Sidebar } from '../../src/views/Sidebar';
import type { BacklogItem, Lane } from '../../src/api/models';

const lanes: Lane[] = [
  { id: 'todo', title: 'To do' },
  { id: 'doing', title: 'Doing' },
  { id: 'done', title: 'Done' },
];

const item = (over: Partial<BacklogItem>): BacklogItem => ({
  id: '1',
  title: 'Item',
  description: 'desc',
  lane: 'todo',
  assignees: [],
  url: 'https://x/1',
  fileLinks: [],
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const items = [
  item({ id: '1', title: 'Mine', assignees: ['me', 'bob'] }),
  item({ id: '2', title: 'Theirs', assignees: ['bob'] }),
  item({ id: '3', title: 'Active', lane: 'doing', assignees: ['me'] }),
];

const renderBoard = (props: Partial<Parameters<typeof BoardView>[0]> = {}) => {
  const onMove = jest.fn();
  const onSaveFileLinks = jest.fn();
  render(<BoardView lanes={lanes} items={items} me="me" onMove={onMove} onSaveFileLinks={onSaveFileLinks} {...props} />);
  return { onMove, onSaveFileLinks };
};

const dataTransfer = () => {
  const data: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => (data[k] = v),
    getData: (k: string) => data[k] ?? '',
    effectAllowed: '',
    dropEffect: '',
  };
};

describe('BoardView', () => {
  it('renders one lane per config entry in order with counts and cards', () => {
    renderBoard();
    const sections = screen.getAllByRole('region');
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['To do', 'Doing', 'Done']);
    expect(within(sections[0]).getByLabelText('2 items')).toBeTruthy();
    expect(within(sections[1]).getByLabelText('1 items')).toBeTruthy();
    expect(within(sections[2]).getByLabelText('0 items')).toBeTruthy();
    expect(within(sections[0]).getByText('#1')).toBeTruthy();
    expect(within(sections[0]).getByText('Mine')).toBeTruthy();
    expect(within(sections[0]).getByText('me, bob')).toBeTruthy();
  });

  it('calls onMove when a card is dropped on another lane, not on its own', () => {
    const { onMove } = renderBoard();
    const card = screen.getByText('Mine').closest('[draggable]') as HTMLElement;
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(screen.getByRole('region', { name: 'Doing' }), { dataTransfer: dt });
    expect(onMove).toHaveBeenCalledWith('1', 'doing');
    onMove.mockClear();
    fireEvent.drop(screen.getByRole('region', { name: 'To do' }), { dataTransfer: dt });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('offers a keyboard-accessible Move to select', () => {
    const { onMove } = renderBoard();
    fireEvent.change(screen.getByLabelText('Move #2 to'), { target: { value: 'done' } });
    expect(onMove).toHaveBeenCalledWith('2', 'done');
  });

  it('My items hides others and lane counts follow the filter', () => {
    renderBoard();
    fireEvent.click(screen.getByLabelText('My items'));
    expect(screen.queryByText('Theirs')).toBeNull();
    expect(screen.getByText('Mine')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'To do' })).getByLabelText('1 items')).toBeTruthy();
  });

  it('assignee picker lists seen assignees and filters', () => {
    renderBoard();
    const picker = screen.getByLabelText('Assignee');
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'bob', 'me']);
    fireEvent.change(picker, { target: { value: 'bob' } });
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.getByText('Theirs')).toBeTruthy();
  });

  it('shows the error as an alert', () => {
    renderBoard({ error: 'move failed' });
    expect(screen.getByRole('alert').textContent).toBe('move failed');
  });

  it('opens the detail with description, source link and file links save', async () => {
    const { onSaveFileLinks } = renderBoard();
    fireEvent.click(screen.getByText('Mine'));
    expect(screen.getByText('desc')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in source' }).getAttribute('href')).toBe('https://x/1');
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    fireEvent.change(screen.getByLabelText('Repo 1'), { target: { value: 'r' } });
    fireEvent.change(screen.getByLabelText('Path 1'), { target: { value: 'a.ts' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(onSaveFileLinks).toHaveBeenCalledWith('1', [{ repo: 'r', path: 'a.ts' }]);
  });
});

describe('Sidebar switch', () => {
  const base = { repositories: [], tasks: [], selectedRepository: null, onSelectRepository: () => {} };
  it('is absent when the backlog is disabled', () => {
    render(<Sidebar {...base} />);
    expect(screen.queryByRole('button', { name: 'Backlog' })).toBeNull();
  });
  it('switches views when enabled', () => {
    const onSelectView = jest.fn();
    render(<Sidebar {...base} backlogEnabled view="tasks" onSelectView={onSelectView} />);
    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
    expect(onSelectView).toHaveBeenCalledWith('backlog');
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBe('true');
  });
});
