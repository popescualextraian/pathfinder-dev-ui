import { render, screen } from '@testing-library/react';
import { AppShell } from '../../src/views/AppShell';
import { StatePill } from '../../src/views/StatePill';
import { Button } from '../../src/views/Button';

jest.mock('../../src/state/use-system-info', () => ({
  useSystemInfo: () => ({ status: 'success', data: { name: 'app', version: '1.2.3', uptimeSeconds: 1 } }),
}));

describe('AppShell', () => {
  it('renders four columns and the footer system info', () => {
    render(<AppShell sidebar={<p>S</p>} list={<p>L</p>} main={<p>M</p>} facts={<p>F</p>} />);
    for (const t of ['S', 'L', 'M', 'F']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByText('app')).toBeTruthy();
    expect(screen.getByText('1.2.3')).toBeTruthy();
  });

  it('renders only sidebar and board when board is given', () => {
    render(<AppShell sidebar={<p>S</p>} list={<p>L</p>} main={<p>M</p>} facts={<p>F</p>} board={<p>B</p>} />);
    expect(screen.getByText('S')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
    for (const t of ['L', 'M', 'F']) expect(screen.queryByText(t)).toBeNull();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tasks' })).toBeNull();
  });

  it('keeps the four-column layout without board', () => {
    render(<AppShell sidebar={<p>S</p>} list={<p>L</p>} main={<p>M</p>} facts={<p>F</p>} />);
    expect(screen.getByRole('region', { name: 'Tasks' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Facts' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Repositories' })).toBeTruthy();
  });
});

describe('StatePill and Button', () => {
  it('shows the state as text', () => {
    render(<StatePill state="waiting" section="needs-you" />);
    expect(screen.getByText('waiting')).toBeTruthy();
  });
  it('is a button', () => {
    render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).getAttribute('type')).toBe('button');
  });
});
