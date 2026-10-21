import { ArgumentsHost } from '@nestjs/common';
import { BridgeErrorFilter } from '../../../../src/api/tasks/bridge-error.filter';
import { BridgeError, BridgeUnreachableError } from '../../../../src/engine';

function run(error: BridgeError | BridgeUnreachableError, originalUrl = '/api/tasks/T-1/prompt') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ originalUrl }), getResponse: () => ({ status }) }),
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

describe('BridgeErrorFilter on the apps routes', () => {
  const at = (error: BridgeError, url: string) => run(error, url);

  it.each([
    [502, 'app_failed', 'agentic-app: prepare of web failed (exit 1); its last lines:\nnpm ERR! missing script'],
    [504, 'app_timeout', 'agentic-app start timed out'],
  ])('passes the bridge %i %s with its message through for an app action', (code, name, text) => {
    for (const url of ['/api/tasks/T-1/apps/web/start', '/api/tasks/T-1/apps/web/restart', '/api/tasks/T-1/apps']) {
      const { status, body } = at(new BridgeError(code, name, text), url);
      expect(status).toBe(code);
      expect(body).toEqual({ statusCode: code, message: text, path: url });
    }
  });

  it('keeps the generic 502 for other codes on the apps routes and for app codes elsewhere', () => {
    expect(at(new BridgeError(502, 'bad_gateway', 'secret'), '/api/tasks/T-1/apps/web/start').body.message)
      .toBe('The task bridge answered unexpectedly');
    expect(at(new BridgeError(500, 'app_failed', 'secret'), '/api/tasks/T-1/apps/web/start').status).toBe(502);
    for (const [code, name] of [[502, 'app_failed'], [504, 'app_timeout']] as const) {
      const { status, body } = at(new BridgeError(code, name, 'secret'), '/api/tasks/T-1/prompt');
      expect(status).toBe(502);
      expect(body.message).toBe('The task bridge answered unexpectedly');
    }
    expect(at(new BridgeError(502, 'app_failed', 'secret'), '/api/tasks/T-1/apps-x').status).toBe(502);
    expect(at(new BridgeError(502, 'app_failed', 'secret'), '/api/tasks/T-1/apps-x').body.message).not.toBe('secret');
  });
});
