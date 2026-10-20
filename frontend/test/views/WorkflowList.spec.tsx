import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { WorkflowList } from '../../src/views/WorkflowList';
import { makeWorkflow } from '../fixtures/workflows';

const refused = [{ file: 'broken.yaml', error: 'steps must be a non-empty list', version: 'rv' }];

const setup = (over: Partial<Parameters<typeof WorkflowList>[0]> = {}) => {
  const props = {
    definitions: [makeWorkflow()],
    refused,
    writable: true,
    onNew: jest.fn(),
    onEdit: jest.fn(),
    onDuplicate: jest.fn(),
    onDelete: jest.fn().mockResolvedValue(null),
    onDeleteRefused: jest.fn().mockResolvedValue(null),
    ...over,
  };
  render(<WorkflowList {...props} />);
  return props;
};

describe('WorkflowList', () => {
  it('shows title, id and the steps as a chain, and the row actions', () => {
    const p = setup();
    const row = screen.getByTestId('workflow-row-plan-implement-review');
    expect(row).toHaveTextContent('Plan, implement, review');
    expect(row).toHaveTextContent('plan-implement-review');
    expect(row).toHaveTextContent('Plan → Implement');
    fireEvent.click(screen.getByRole('button', { name: 'New workflow' }));
    fireEvent.click(within(row).getByRole('button', { name: /^Edit/ }));
    fireEvent.click(within(row).getByRole('button', { name: /^Duplicate/ }));
    expect(p.onNew).toHaveBeenCalled();
    expect(p.onEdit).toHaveBeenCalledWith('plan-implement-review');
    expect(p.onDuplicate).toHaveBeenCalledWith('plan-implement-review');
  });

  it('deletes only after the confirm', async () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Plan, implement, review' }));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Plan, implement, review' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(p.onDelete).toHaveBeenCalledWith('plan-implement-review');
  });

  it('shows a delete error', async () => {
    setup({ onDelete: jest.fn().mockResolvedValue('workflow in use') });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Plan, implement, review' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('workflow in use');
  });

  it('lists a refused file with its error and only Delete', () => {
    const p = setup();
    const row = screen.getByTestId('workflow-refused-broken.yaml');
    expect(row).toHaveTextContent('steps must be a non-empty list');
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(within(row).getByRole('button', { name: 'Delete file broken.yaml' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(p.onDeleteRefused).toHaveBeenCalledWith('broken.yaml', 'rv');
  });

  it('read-only: a notice and no write actions', () => {
    setup({ writable: false });
    expect(screen.getByRole('status')).toHaveTextContent('read-only');
    expect(screen.queryByRole('button', { name: 'New workflow' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Duplicate/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^View/ })).toBeInTheDocument();
  });
});
