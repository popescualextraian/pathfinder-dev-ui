import { fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from '../../src/views/Sidebar';
import { makeTask } from '../fixtures/tasks';

const repos = [{ name: 'repo-a', url: 'u', default: true }];

function setup(over: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props = {
    repositories: repos,
    tasks: [makeTask(), makeTask({ id: 'T-2', closed: true })],
    selectedRepository: null,
    onSelectRepository: jest.fn(),
    onSelectView: jest.fn(),
    ...over,
  };
  render(<Sidebar {...props} />);
  return props;
}

describe('Sidebar', () => {
  it('Architect is the first entry of group Team, only when enabled', () => {
    setup({ architectEnabled: true });
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Work', 'Automate', 'Team']);
    expect(screen.getByRole('button', { name: 'Architect' })).toBeTruthy();
  });

  it('Architect selects its view; with it off there is no Team group', () => {
    const props = setup({ architectEnabled: true, view: 'architect' });
    fireEvent.click(screen.getByRole('button', { name: 'Architect' }));
    expect(props.onSelectView).toHaveBeenCalledWith('architect');
  });
  it('groups Work then Automate, no Show or Team heading', () => {
    setup({ backlogEnabled: true, workflowsEnabled: true });
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['Work', 'Automate']);
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const order = ['Backlog', 'Tasks', 'Workflows', 'Schedules'].map((n) => names.findIndex((x) => x.startsWith(n)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('backlog and workflows off: Tasks under Work, Schedules (always on) under Automate', () => {
    setup();
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Work', 'Automate']);
    expect(screen.getByRole('button', { name: 'Tasks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Schedules' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Backlog' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Workflows' })).toBeNull();
  });

  it('Schedules selects its view and is marked current there, with a clock icon', () => {
    const p = setup({ view: 'schedules' });
    const entry = screen.getByRole('button', { name: 'Schedules' });
    expect(entry.getAttribute('aria-current')).toBe('true');
    expect(entry.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /All repositories/ })).toBeNull();
    fireEvent.click(entry);
    expect(p.onSelectView).toHaveBeenCalledWith('schedules');
  });

  it('backlog off, workflows on: Automate shown, no Backlog', () => {
    setup({ workflowsEnabled: true });
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Work', 'Automate']);
    expect(screen.getByRole('button', { name: 'Workflows' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Backlog' })).toBeNull();
  });

  it('shows the repository list only on the Tasks view', () => {
    setup({ view: 'tasks' });
    expect(screen.getByRole('button', { name: /All repositories/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /repo-a/ })).toBeTruthy();
  });

  it.each(['backlog', 'workflows'] as const)('hides the repository list on %s', (view) => {
    setup({ view, backlogEnabled: true, workflowsEnabled: true });
    expect(screen.queryByRole('button', { name: /All repositories/ })).toBeNull();
  });

  it('zero repositories: All repositories with 0', () => {
    setup({ repositories: [], tasks: [] });
    expect(screen.getByRole('button', { name: /All repositories/ }).textContent).toContain('0');
  });

  it('clicking calls the handlers', () => {
    const p = setup({ backlogEnabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
    expect(p.onSelectView).toHaveBeenCalledWith('backlog');
    fireEvent.click(screen.getByRole('button', { name: /repo-a/ }));
    expect(p.onSelectRepository).toHaveBeenCalledWith('repo-a');
  });

  it('shows open-task and backlog counts', () => {
    setup({ backlogEnabled: true, backlogCount: 8 });
    expect(screen.getByRole('button', { name: 'Backlog' }).textContent).toContain('8');
    expect(screen.getByRole('button', { name: 'Tasks' }).textContent).toContain('1');
  });

  it('a view without a visible entry falls back to Tasks as current, with its repository list', () => {
    setup({ view: 'backlog', backlogEnabled: false });
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: /All repositories/ })).toBeTruthy();
  });

  it('backlog on, workflows off: Automate holds only Schedules', () => {
    setup({ backlogEnabled: true });
    expect(screen.getByRole('heading', { name: 'Automate' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Workflows' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Schedules' })).toBeTruthy();
  });

  it('marks the current view', () => {
    setup({ view: 'workflows', backlogEnabled: true, workflowsEnabled: true });
    expect(screen.getByRole('button', { name: 'Workflows' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('Sidebar without architect', () => {
  it('drops the Team group', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Architect' })).toBeNull();
    expect(screen.queryByText('Team')).toBeNull();
  });
});
