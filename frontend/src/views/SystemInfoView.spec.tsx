import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useSystemInfo } from '../state/use-system-info';
import { SystemInfoView } from './SystemInfoView';

jest.mock('../state/use-system-info');
const hookMock = jest.mocked(useSystemInfo);

describe('SystemInfoView', () => {
  it('shows a loading state', () => {
    hookMock.mockReturnValue({ status: 'loading' });
    render(<SystemInfoView />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error state', () => {
    hookMock.mockReturnValue({ status: 'error', message: 'nope' });
    render(<SystemInfoView />);
    expect(screen.getByRole('alert')).toHaveTextContent('nope');
  });

  it('shows name, version and uptime', () => {
    hookMock.mockReturnValue({
      status: 'success',
      data: { name: 'app', version: '1.2.3', uptimeSeconds: 42 },
    });
    render(<SystemInfoView />);
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText('42 s')).toBeInTheDocument();
  });
});
