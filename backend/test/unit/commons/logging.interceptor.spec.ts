import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { LoggingInterceptor } from '../../../src/commons/logging.interceptor';

function contextFor(method: string, url: string, statusCode: number): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, originalUrl: url }),
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}

describe('LoggingInterceptor', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs method, path, status and duration and passes the result through', async () => {
    const next: CallHandler = { handle: () => of('result') };

    const result = await lastValueFrom(
      new LoggingInterceptor().intercept(contextFor('GET', '/api/x', 200), next),
    );

    expect(result).toBe('result');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(/^GET \/api\/x 200 \d+ms$/);
  });

  it('does not swallow errors from the handler', async () => {
    const next: CallHandler = { handle: () => throwError(() => new Error('boom')) };

    await expect(
      lastValueFrom(new LoggingInterceptor().intercept(contextFor('GET', '/api/x', 200), next)),
    ).rejects.toThrow('boom');
  });
});
