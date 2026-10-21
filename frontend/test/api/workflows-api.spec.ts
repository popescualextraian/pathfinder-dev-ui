import {
  advanceRun, createWorkflow, deleteRefusedWorkflow, deleteWorkflow, listRuns, listWorkflows, readWorkflow, startRun,
  stopRun, updateWorkflow, validateWorkflow, startGeneration, listGenerations, getGeneration, requestGenerationChanges,
  discardGeneration, markGenerationSaved,
} from '../../src/api/workflows-api';
import { ApiError } from '../../src/api/http';
import type { WorkflowDefinition } from '../../src/api/models';

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

describe('workflows-api', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('listWorkflows returns the response, null on 404, rethrows others', async () => {
    fetchMock.mockReturnValue(json(200, { definitions: [], refused: [], writable: true }));
    expect(await listWorkflows()).toEqual({ definitions: [], refused: [], writable: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/workflows', undefined);
    fetchMock.mockReturnValue(json(404, { message: 'Cannot GET' }));
    expect(await listWorkflows()).toBeNull();
    fetchMock.mockReturnValue(json(500, { message: 'bad' }));
    await expect(listWorkflows()).rejects.toBeInstanceOf(ApiError);
  });

  it('listRuns with and without itemId', async () => {
    fetchMock.mockReturnValue(json(200, []));
    await listRuns();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/workflow-runs', undefined);
    await listRuns('a/b');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/workflow-runs?itemId=a%2Fb', undefined);
  });

  it('startRun posts item and workflow', async () => {
    fetchMock.mockReturnValue(json(201, { id: 'R-1' }));
    expect(await startRun('7', 'wf')).toEqual({ id: 'R-1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/workflow-runs');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ itemId: '7', workflowId: 'wf' });
  });

  it('advanceRun posts force only when asked; stopRun posts', async () => {
    fetchMock.mockReturnValue(json(200, { id: 'R-1' }));
    await advanceRun('R-1');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/workflow-runs/R-1/advance', { method: 'POST' });
    await advanceRun('R-1', true);
    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse(init.body)).toEqual({ force: true });
    await stopRun('R-1');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/workflow-runs/R-1/stop', { method: 'POST' });
  });

  it('startRun rejects with the API error', async () => {
    fetchMock.mockReturnValue(json(409, { message: 'active run' }));
    await expect(startRun('7', 'wf')).rejects.toMatchObject({ status: 409, message: 'active run' });
  });

  describe('editing', () => {
    const def: WorkflowDefinition = {
      title: 'T',
      steps: [
        { id: 'plan', title: 'Plan', gate: 'human', prompt: 'plan', model: 'sonnet' },
        { id: 'build', title: 'Build', gate: 'auto', prompt: 'build', continue: 'plan' },
        { id: 'review', title: 'Review', gate: 'human', prompt: 'review', fork: 'build' },
      ],
    };
    it('readWorkflow encodes the id', async () => {
      fetchMock.mockReturnValue(json(200, { definition: def, version: 'v1' }));
      expect(await readWorkflow('a b')).toEqual({ definition: def, version: 'v1' });
      expect(fetchMock).toHaveBeenCalledWith('/api/workflows/a%20b', undefined);
    });

    it('validateWorkflow posts the definition and returns the errors', async () => {
      fetchMock.mockReturnValue(json(200, { errors: [{ message: 'bad', stepId: 's' }] }));
      expect(await validateWorkflow(def)).toEqual([{ message: 'bad', stepId: 's' }]);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/workflows/validate');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ definition: def });
    });

    it('createWorkflow posts id and definition', async () => {
      fetchMock.mockReturnValue(json(201, { definition: def, version: 'v1' }));
      await createWorkflow('wf', def);
      const [url, init] = fetchMock.mock.calls[0];
      expect([url, init.method]).toEqual(['/api/workflows', 'POST']);
      expect(JSON.parse(init.body)).toEqual({ id: 'wf', definition: def });
    });

    it('updateWorkflow puts definition and version', async () => {
      fetchMock.mockReturnValue(json(200, { definition: def, version: 'v2' }));
      await updateWorkflow('wf', def, 'v1');
      const [url, init] = fetchMock.mock.calls[0];
      expect([url, init.method]).toEqual(['/api/workflows/wf', 'PUT']);
      expect(JSON.parse(init.body)).toEqual({ definition: def, version: 'v1' });
    });

    it('deletes send the version in the query', async () => {
      fetchMock.mockReturnValue(Promise.resolve({ ok: true, status: 204 } as Response));
      await deleteWorkflow('wf', 'v/1');
      expect(fetchMock).toHaveBeenLastCalledWith('/api/workflows/wf?version=v%2F1', { method: 'DELETE' });
      await deleteRefusedWorkflow('bad one.yaml', 'v1');
      expect(fetchMock).toHaveBeenLastCalledWith('/api/workflows/refused/bad%20one.yaml?version=v1', {
        method: 'DELETE',
      });
    });

    it('errors carry status and the location of a rule violation', async () => {
      fetchMock.mockReturnValue(json(400, { message: 'no prompt', location: { stepId: 's', field: 'prompt' } }));
      const e = await updateWorkflow('wf', def, 'v1').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ApiError);
      expect(e).toMatchObject({ status: 400, message: 'no prompt', location: { stepId: 's', field: 'prompt' } });
      fetchMock.mockReturnValue(json(409, { message: 'changed' }));
      await expect(updateWorkflow('wf', def, 'v1')).rejects.toMatchObject({ status: 409, location: undefined });
    });
  });
});

describe('workflows-api generations', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn().mockReturnValue(json(200, { id: 'G-1' }));
    global.fetch = fetchMock;
  });
  const body = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  it('startGeneration posts description, model only when given', async () => {
    await startGeneration('make one', 'opus');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workflows/generations');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(body()).toEqual({ description: 'make one', model: 'opus' });
    fetchMock.mockClear();
    await startGeneration('x');
    expect(body()).toEqual({ description: 'x' });
  });

  it('list and get', async () => {
    await listGenerations();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/workflows/generations', undefined);
    await getGeneration('G 1');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/workflows/generations/G%201', undefined);
  });

  it('changes, discard and saved post to the generation', async () => {
    await requestGenerationChanges('G-1', 'more');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workflows/generations/G-1/changes');
    expect(body()).toEqual({ text: 'more' });
    await discardGeneration('G-1');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/workflows/generations/G-1/discard');
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
    await markGenerationSaved('G-1');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/workflows/generations/G-1/saved');
  });
});
