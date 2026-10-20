import { act, fireEvent, render, screen } from '@testing-library/react';
import { ItemDialog } from '../../src/views/ItemDialog';
import type { BacklogItem, Lane } from '../../src/api/models';

const lanes: Lane[] = [
  { id: 'todo', title: 'To do' },
  { id: 'doing', title: 'Doing' },
];
const existing: BacklogItem = {
  id: '5', title: 'Old', description: 'old body', lane: 'todo', assignees: ['a', 'b'], url: 'u', fileLinks: [], updatedAt: '2026-01-01T00:00:00Z',
};

const setup = (props: Partial<Parameters<typeof ItemDialog>[0]> = {}) => {
  const onCreate = jest.fn().mockResolvedValue(undefined);
  const onUpdate = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  render(<ItemDialog lanes={lanes} onCreate={onCreate} onUpdate={onUpdate} onClose={onClose} {...props} />);
  return { onCreate, onUpdate, onClose };
};
const save = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });

describe('ItemDialog', () => {
  it('is a labelled form with a lane select preset to the first lane, and Save disabled for an empty title', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'New item' })).toBeTruthy();
    expect((screen.getByLabelText('Lane') as HTMLSelectElement).value).toBe('todo');
    expect(screen.queryByLabelText('Assignees')).toBeNull();
    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '   ' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Hi' } });
    expect(button.disabled).toBe(false);
  });

  it('creates with the trimmed title, description and chosen lane, then closes', async () => {
    const { onCreate, onClose } = setup();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' Hi ' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Body' } });
    fireEvent.change(screen.getByLabelText('Lane'), { target: { value: 'doing' } });
    await save();
    expect(onCreate).toHaveBeenCalledWith({ title: 'Hi', description: 'Body', lane: 'doing' });
    expect(onClose).toHaveBeenCalled();
  });

  it('edits: prefilled, no lane select, assignees parsed from a comma list, only changes sent', async () => {
    const { onUpdate, onClose } = setup({ item: existing });
    expect(screen.getByRole('dialog', { name: 'Edit item #5' })).toBeTruthy();
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('old body');
    expect(screen.queryByLabelText('Lane')).toBeNull();
    fireEvent.change(screen.getByLabelText('Assignees'), { target: { value: ' b, c ,, ' } });
    await save();
    expect(onUpdate).toHaveBeenCalledWith('5', { assignees: ['b', 'c'] });
    expect(onClose).toHaveBeenCalled();
  });

  it('clearing the assignees sends an empty list', async () => {
    const { onUpdate } = setup({ item: existing });
    fireEvent.change(screen.getByLabelText('Assignees'), { target: { value: '' } });
    await save();
    expect(onUpdate).toHaveBeenCalledWith('5', { assignees: [] });
  });

  it('closes without a request when nothing changed', async () => {
    const { onUpdate, onClose } = setup({ item: existing });
    await save();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a failure inline, stays open and keeps the input', async () => {
    const onCreate = jest.fn().mockRejectedValue(new Error('Unknown assignee'));
    const { onClose } = setup({ onCreate });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Hi' } });
    await save();
    expect(screen.getByRole('alert').textContent).toBe('Unknown assignee');
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Hi');
  });

  it('closes on Cancel and on Escape', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
