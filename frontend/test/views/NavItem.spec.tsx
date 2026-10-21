import { fireEvent, render, screen } from '@testing-library/react';
import { NavItem } from '../../src/views/NavItem';

describe('NavItem', () => {
  it('is a button named by its label only', () => {
    render(<NavItem label="Backlog" icon="backlog" active={false} count={8} onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Backlog' })).toBeTruthy();
  });

  it('marks the active item', () => {
    const { rerender } = render(<NavItem label="Tasks" icon="tasks" active onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBe('true');
    rerender(<NavItem label="Tasks" icon="tasks" active={false} onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBeNull();
  });

  it('shows the count only when given', () => {
    const { rerender } = render(<NavItem label="Backlog" icon="backlog" active={false} count={8} onClick={() => undefined} />);
    expect(screen.getByText('8')).toBeTruthy();
    rerender(<NavItem label="Backlog" icon="backlog" active={false} onClick={() => undefined} />);
    expect(screen.queryByText('8')).toBeNull();
  });

  it('calls onClick', () => {
    const fn = jest.fn();
    render(<NavItem label="Workflows" icon="workflows" active={false} onClick={fn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
