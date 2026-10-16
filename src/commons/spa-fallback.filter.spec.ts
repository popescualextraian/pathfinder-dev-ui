import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import { SpaFallbackFilter } from './spa-fallback.filter';

function hostWith(request: object, response: object): ArgumentsHost {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
}

describe('SpaFallbackFilter', () => {
  const filter = new SpaFallbackFilter('/srv/frontend');
  const notFound = new NotFoundException();

  it('sends index.html for a GET outside /api', () => {
    const response = { sendFile: jest.fn() };
    filter.catch(notFound, hostWith({ method: 'GET', originalUrl: '/some/view' }, response));
    expect(response.sendFile).toHaveBeenCalledWith('index.html', { root: '/srv/frontend' });
  });

  it.each([
    ['an /api path', { method: 'GET', originalUrl: '/api/nope' }],
    ['a non-GET request', { method: 'POST', originalUrl: '/some/view' }],
  ])('answers %s with the JSON error', (_name, request) => {
    const json = jest.fn();
    const response = { sendFile: jest.fn(), status: jest.fn().mockReturnValue({ json }) };
    filter.catch(notFound, hostWith(request, response));
    expect(response.sendFile).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ statusCode: 404, message: 'Not Found', path: request.originalUrl });
  });
});
