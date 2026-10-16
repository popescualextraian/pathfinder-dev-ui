import { ArgumentsHost, BadRequestException, HttpStatus, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from '../../../src/commons/all-exceptions.filter';

function hostWith(json: jest.Mock, url = '/api/x'): ArgumentsHost {
  const status = jest.fn().mockReturnValue({ json });
  return {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: url }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('maps an HttpException to { statusCode, message, path }', () => {
    const json = jest.fn();
    new AllExceptionsFilter().catch(new BadRequestException('bad input'), hostWith(json));
    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'bad input', path: '/api/x' });
  });

  it('keeps the message list of a validation error', () => {
    const json = jest.fn();
    const ex = new BadRequestException({ message: ['a must be set', 'b must be set'] });
    new AllExceptionsFilter().catch(ex, hostWith(json));
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message: ['a must be set', 'b must be set'],
      path: '/api/x',
    });
  });

  it('maps unknown errors to 500 without leaking the message', () => {
    const json = jest.fn();
    new AllExceptionsFilter().catch(new Error('secret'), hostWith(json));
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      path: '/api/x',
    });
  });
});
