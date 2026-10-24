import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { BridgeError, BridgeUnreachableError } from '../../engine';

// Bridge errors the client can act on keep their status and the bridge's message. 401/403 and
// anything else unexpected mean the engine is misconfigured or the bridge is broken: 502 with a fixed
// message (the bridge's own text is not passed on). Never includes tokens, URLs or hosts.
const PASS_THROUGH = new Set<number>([
  HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.SERVICE_UNAVAILABLE,
]);

// On the apps routes a failed or timed-out agentic-app run (502 app_failed, 504 app_timeout) also keeps its
// status and message: the bridge sends the app's last output lines with its tokens masked.
const APP_ROUTE = /^\/api\/tasks\/[^/?#]+\/apps(?:[/?#]|$)/;
const APP_PASS_THROUGH = new Map<number, string>([[HttpStatus.BAD_GATEWAY, 'app_failed'], [HttpStatus.GATEWAY_TIMEOUT, 'app_timeout']]);

export function describeBridgeError(exception: BridgeError | BridgeUnreachableError, path = ''): { statusCode: number; message: string } {
  if (exception instanceof BridgeUnreachableError) {
    return { statusCode: HttpStatus.BAD_GATEWAY, message: 'The task bridge is not reachable' };
  }
  if (PASS_THROUGH.has(exception.status)) return { statusCode: exception.status, message: exception.message };
  if (APP_ROUTE.test(path) && APP_PASS_THROUGH.get(exception.status) === exception.code) {
    return { statusCode: exception.status, message: exception.message };
  }
  return { statusCode: HttpStatus.BAD_GATEWAY, message: 'The task bridge answered unexpectedly' };
}

@Catch(BridgeError, BridgeUnreachableError)
export class BridgeErrorFilter implements ExceptionFilter {
  catch(exception: BridgeError | BridgeUnreachableError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const path = http.getRequest<Request>().originalUrl;
    const { statusCode, message } = describeBridgeError(exception, path);
    http.getResponse<Response>().status(statusCode).json({ statusCode, message, path });
  }
}
