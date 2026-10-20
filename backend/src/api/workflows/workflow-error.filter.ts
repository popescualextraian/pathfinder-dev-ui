import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { WorkflowConflictError, WorkflowInvalidError, WorkflowNotFoundError } from '../../workflow';

type WorkflowError = WorkflowNotFoundError | WorkflowConflictError | WorkflowInvalidError;

// Not found 404, conflict 409, invalid 400, with the message of the package's own errors (safe to show). Other errors
// (the engine's HTTP exceptions, backlog and bridge errors that a run action passes on) are left to the other filters.
export function describeWorkflowError(exception: WorkflowError): { statusCode: number; message: string } {
  if (exception instanceof WorkflowNotFoundError) return { statusCode: HttpStatus.NOT_FOUND, message: exception.message };
  if (exception instanceof WorkflowConflictError) return { statusCode: HttpStatus.CONFLICT, message: exception.message };
  return { statusCode: HttpStatus.BAD_REQUEST, message: exception.message };
}

@Catch(WorkflowNotFoundError, WorkflowConflictError, WorkflowInvalidError)
export class WorkflowErrorFilter implements ExceptionFilter {
  catch(exception: WorkflowError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const path = http.getRequest<Request>().originalUrl;
    const { statusCode, message } = describeWorkflowError(exception);
    http.getResponse<Response>().status(statusCode).json({ statusCode, message, path });
  }
}
