import { render, screen } from '@testing-library/react';
import { RepositoryList } from '../../src/views/RepositoryList';

describe('RepositoryList', () => {
  it('gives every entry its full name as a tooltip, for names the sidebar has to wrap', () => {
    const long = 'digital-rotation-planning-docs';
    render(<RepositoryList repositories={[{ name: long, url: 'https://h.invalid/g/r', default: false }]} tasks={[]} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: new RegExp(long) }).getAttribute('title')).toBe(long);
  });
});
