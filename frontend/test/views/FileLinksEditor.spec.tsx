import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FileLinksEditor } from '../../src/views/FileLinksEditor';

describe('FileLinksEditor', () => {
  it('adds, edits, removes and saves rows; optional fields are dropped when empty', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<FileLinksEditor links={[{ repo: 'a', path: 'x.ts', ref: 'main' }]} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    fireEvent.change(screen.getByLabelText('Repo 2'), { target: { value: 'b' } });
    fireEvent.change(screen.getByLabelText('Path 2'), { target: { value: 'y.ts' } });
    fireEvent.change(screen.getByLabelText('Note 2'), { target: { value: 'n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([
        { repo: 'a', path: 'x.ts', ref: 'main' },
        { repo: 'b', path: 'y.ts', note: 'n' },
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove link 1' }));
    expect(screen.queryByDisplayValue('x.ts')).toBeNull();
    expect(screen.getByDisplayValue('y.ts')).toBeTruthy();
  });

  it('disables Save while a row has an empty repo or path', () => {
    render(<FileLinksEditor links={[]} onSave={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Repo 1'), { target: { value: 'r' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Path 1'), { target: { value: 'p' } });
    expect(save.disabled).toBe(false);
  });

  it('shows a save failure', async () => {
    render(<FileLinksEditor links={[{ repo: 'a', path: 'b' }]} onSave={jest.fn().mockRejectedValue(new Error('nope'))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('nope');
  });
});
