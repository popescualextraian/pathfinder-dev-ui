import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '../../src/api/http';
import { useWorkflows } from '../../src/state/use-workflows';
import * as api from '../../src/api/workflows-api';
import { makeWorkflow } from '../fixtures/workflows';

jest.mock('../../src/api/workflows-api');
const listWorkflows = api.listWorkflows as jest.Mock;

describe('useWorkflows', () => {
  beforeEach(() => jest.resetAllMocks());

  it('is off without error when the backend answers null', async () => {
    listWorkflows.mockResolvedValue(null);
    const { result } = renderHook(() => useWorkflows());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ enabled: false, error: null, definitions: [], refused: [] });
  });

  it('loads definitions and refused once', async () => {
    const refused = [{ file: 'bad.yaml', error: 'bad' }];
    listWorkflows.mockResolvedValue({ definitions: [makeWorkflow()], refused, writable: false });
    const { result } = renderHook(() => useWorkflows());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.definitions.map((d) => d.id)).toEqual(['plan-implement-review']);
    expect(result.current.refused).toEqual(refused);
    expect(result.current.writable).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(listWorkflows).toHaveBeenCalledTimes(1);
  });

  it('shows a load failure as error and stays off', async () => {
    listWorkflows.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useWorkflows());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ enabled: false, error: 'boom' });
  });

  it('remove deletes with the version the list loaded, without reading the file again', async () => {
    listWorkflows.mockResolvedValue({ definitions: [makeWorkflow({ version: 'v-listed' })], refused: [], writable: true });
    (api.deleteWorkflow as jest.Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useWorkflows());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    let outcome: string | null = 'x';
    await act(async () => {
      outcome = await result.current.remove('plan-implement-review', 'v-listed');
    });
    expect(outcome).toBeNull();
    expect(api.deleteWorkflow).toHaveBeenCalledWith('plan-implement-review', 'v-listed');
    expect(api.readWorkflow).not.toHaveBeenCalled();
    expect(listWorkflows).toHaveBeenCalledTimes(2);
  });

  it('remove of a file changed since the list was loaded says so and reloads the list', async () => {
    listWorkflows.mockResolvedValue({ definitions: [makeWorkflow({ version: 'v-listed' })], refused: [], writable: true });
    (api.deleteWorkflow as jest.Mock).mockRejectedValue(new ApiError(409, 'The workflow was changed by someone else'));
    const { result } = renderHook(() => useWorkflows());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    let outcome: string | null = null;
    await act(async () => {
      outcome = await result.current.remove('plan-implement-review', 'v-listed');
    });
    expect(outcome).toMatch(/changed since the list was loaded/);
    expect(listWorkflows).toHaveBeenCalledTimes(2);
  });

  it('remove without a listed version reads it first', async () => {
    listWorkflows.mockResolvedValue({ definitions: [makeWorkflow()], refused: [], writable: true });
    (api.readWorkflow as jest.Mock).mockResolvedValue({ definition: {}, version: 'v-read' });
    (api.deleteWorkflow as jest.Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useWorkflows());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await act(async () => {
      await result.current.remove('plan-implement-review');
    });
    expect(api.deleteWorkflow).toHaveBeenCalledWith('plan-implement-review', 'v-read');
  });
});
