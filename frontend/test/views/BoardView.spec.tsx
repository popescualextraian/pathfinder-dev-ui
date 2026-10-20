import { useState } from 'react';
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
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
  const onCreate = jest.fn().mockResolvedValue(undefined);
  const onUpdate = jest.fn().mockResolvedValue(undefined);
  render(
    <BoardView lanes={lanes} items={items} me="me" onMove={onMove} onSaveFileLinks={onSaveFileLinks} onCreate={onCreate} onUpdate={onUpdate} {...props} />,
  );
  return { onMove, onSaveFileLinks, onCreate, onUpdate };
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

  it('ignores a drop that carries only plain text', () => {
    const { onMove } = renderBoard();
    const dt = dataTransfer();
    dt.setData('text/plain', '1');
    fireEvent.drop(screen.getByRole('region', { name: 'Doing' }), { dataTransfer: dt });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('keeps the drop highlight on dragleave into the lane and clears it when leaving', () => {
    renderBoard();
    const lane = screen.getByRole('region', { name: 'Doing' });
    const inside = within(lane).getByText('Active');
    // jsdom drops relatedTarget from the init dict, so set it on the event.
    const leave = (target: HTMLElement, related: Element) => {
      const ev = createEvent.dragLeave(target);
      Object.defineProperty(ev, 'relatedTarget', { value: related });
      fireEvent(target, ev);
    };
    fireEvent.dragOver(lane, { dataTransfer: dataTransfer() });
    expect(lane.className).toContain('over');
    leave(lane, inside);
    expect(lane.className).toContain('over');
    leave(lane, document.body);
    expect(lane.className).not.toContain('over');
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

describe('BoardView create and edit', () => {
  it('New item opens the dialog; saving creates the item, which then appears in its lane', async () => {
    const Harness = () => {
      const [list, setList] = useState(items);
      const onCreate = async (draft: { title: string; description?: string; lane?: string }) => {
        setList((l) => [...l, item({ id: '9', title: draft.title, lane: draft.lane ?? 'todo' })]);
      };
      return <BoardView lanes={lanes} items={list} me="me" onMove={jest.fn()} onSaveFileLinks={jest.fn()} onCreate={onCreate} onUpdate={jest.fn()} />;
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'New item' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Brand new' } });
    fireEvent.change(screen.getByLabelText('Lane'), { target: { value: 'doing' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Doing' })).getByText('Brand new')).toBeTruthy();
  });

  it('Edit in the detail opens the dialog with the item and saves only what changed', async () => {
    const { onUpdate } = renderBoard();
    fireEvent.click(screen.getByText('Mine'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Mine');
    expect((screen.getByLabelText('Assignees') as HTMLInputElement).value).toBe('me, bob');
    expect(screen.queryByLabelText('Lane')).toBeNull();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    });
    expect(onUpdate).toHaveBeenCalledWith('1', { title: 'Renamed' });
    expect(screen.queryByRole('dialog')).toBeNull();
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
