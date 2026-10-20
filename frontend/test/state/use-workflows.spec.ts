import { renderHook, waitFor } from '@testing-library/react';
import { useWorkflows } from '../../src/state/use-workflows';
import * as api from '../../src/api/workflows-api';
import { makeWorkflow } from '../fixtures/workflows';

jest.mock('../../src/api/workflows-api');
const listWorkflows = api.listWorkflows as jest.Mock;

describe('useWorkflows', () => {
  beforeEach(() => listWorkflows.mockReset());

  it('is off without error when the backend answers null', async () => {
    listWorkflows.mockResolvedValue(null);
    const { result } = renderHook(() => useWorkflows());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ enabled: false, error: null, definitions: [], refused: [] });
  });

  it('loads definitions and refused once', async () => {
    const refused = [{ file: 'bad.yaml', error: 'bad' }];
    listWorkflows.mockResolvedValue({ definitions: [makeWorkflow()], refused });
    const { result } = renderHook(() => useWorkflows());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.definitions.map((d) => d.id)).toEqual(['plan-implement-review']);
    expect(result.current.refused).toEqual(refused);
    expect(result.current.loading).toBe(false);
    expect(listWorkflows).toHaveBeenCalledTimes(1);
  });

  it('shows a load failure as error and stays off', async () => {
    listWorkflows.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useWorkflows());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ enabled: false, error: 'boom' });
  });
});
