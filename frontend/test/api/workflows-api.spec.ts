import { advanceRun, listRuns, listWorkflows, startRun, stopRun } from '../../src/api/workflows-api';
import { ApiError } from '../../src/api/http';

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

describe('workflows-api', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('listWorkflows returns the response, null on 404, rethrows others', async () => {
    fetchMock.mockReturnValue(json(200, { definitions: [], refused: [] }));
    expect(await listWorkflows()).toEqual({ definitions: [], refused: [] });
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
});
