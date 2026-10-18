import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { BridgeError, BridgeUnreachableError } from '../../engine';

// Bridge errors the client can act on keep their status and the bridge's message. 401/403 and
// anything else unexpected mean the engine is misconfigured or the bridge is broken: 502 with a fixed
// message (the bridge's own text is not passed on). Never includes tokens, URLs or hosts.
const PASS_THROUGH = new Set<number>([
  HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.SERVICE_UNAVAILABLE,
]);

export function describeBridgeError(exception: BridgeError | BridgeUnreachableError): { statusCode: number; message: string } {
  if (exception instanceof BridgeUnreachableError) {
    return { statusCode: HttpStatus.BAD_GATEWAY, message: 'The task bridge is not reachable' };
  }
  if (PASS_THROUGH.has(exception.status)) return { statusCode: exception.status, message: exception.message };
  return { statusCode: HttpStatus.BAD_GATEWAY, message: 'The task bridge answered unexpectedly' };
}

@Catch(BridgeError, BridgeUnreachableError)
export class BridgeErrorFilter implements ExceptionFilter {
  catch(exception: BridgeError | BridgeUnreachableError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const path = http.getRequest<Request>().originalUrl;
    const { statusCode, message } = describeBridgeError(exception);
    http.getResponse<Response>().status(statusCode).json({ statusCode, message, path });
  }
}
