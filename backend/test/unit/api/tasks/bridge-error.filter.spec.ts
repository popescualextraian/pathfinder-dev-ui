import { ArgumentsHost } from '@nestjs/common';
import { BridgeErrorFilter } from '../../../../src/api/tasks/bridge-error.filter';
import { BridgeError, BridgeUnreachableError } from '../../../../src/engine';

function run(error: BridgeError | BridgeUnreachableError) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/tasks/T-1/prompt' }), getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  new BridgeErrorFilter().catch(error, host);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] as Record<string, unknown> };
}

describe('BridgeErrorFilter', () => {
  it.each([
    [400, 'bad_request'],
    [404, 'not_found'],
    [409, 'conflict'],
    [503, 'starting'],
  ])('passes %i through with the bridge message', (code, name) => {
    const { status, body } = run(new BridgeError(code, name, 'bridge says no'));
    expect(status).toBe(code);
    expect(body).toEqual({ statusCode: code, message: 'bridge says no', path: '/api/tasks/T-1/prompt' });
  });

  it.each([401, 403, 500, 502])('maps bridge %i to 502 with a generic message', (code) => {
    const { status, body } = run(new BridgeError(code, 'x', 'Bearer secret-token http://agentic-ui-task-1:8765'));
    expect(status).toBe(502);
    expect(JSON.stringify(body)).not.toMatch(/secret-token|agentic-ui-task/);
  });

  it('maps an unreachable bridge to 502 without leaking the reason', () => {
    const { status, body } = run(new BridgeUnreachableError('ECONNREFUSED agentic-ui-task-1:8765'));
    expect(status).toBe(502);
    expect(body.message).toBe('The task bridge is not reachable');
    expect(JSON.stringify(body)).not.toContain('agentic-ui-task');
  });
});
