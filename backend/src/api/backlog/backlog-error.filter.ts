import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { BacklogConflictError, BacklogNotFoundError, BacklogUnreachableError, safeMessage } from '../../backlog';

type BacklogError = BacklogNotFoundError | BacklogConflictError | BacklogUnreachableError;

// Not found 404, changed in the source 409, source unreachable 503. The message is the fixed text of
// our own error classes: never tokens, URLs or upstream response bodies. Other errors are not caught.
export function describeBacklogError(exception: BacklogError): { statusCode: number; message: string } {
  const message = safeMessage(exception);
  if (exception instanceof BacklogNotFoundError) return { statusCode: HttpStatus.NOT_FOUND, message };
  if (exception instanceof BacklogConflictError) return { statusCode: HttpStatus.CONFLICT, message };
  return { statusCode: HttpStatus.SERVICE_UNAVAILABLE, message };
}

@Catch(BacklogNotFoundError, BacklogConflictError, BacklogUnreachableError)
export class BacklogErrorFilter implements ExceptionFilter {
  catch(exception: BacklogError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const path = http.getRequest<Request>().originalUrl;
    const { statusCode, message } = describeBacklogError(exception);
    http.getResponse<Response>().status(statusCode).json({ statusCode, message, path });
  }
}
