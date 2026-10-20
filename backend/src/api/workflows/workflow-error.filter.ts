import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  WorkflowConflictError, WorkflowDefinitionError, WorkflowErrorLocation, WorkflowInvalidError, WorkflowNotFoundError, WorkflowReadOnlyError,
} from '../../workflow';

type WorkflowError =
  | WorkflowNotFoundError | WorkflowConflictError | WorkflowInvalidError | WorkflowReadOnlyError | WorkflowDefinitionError;

// Not found 404, conflict 409, read-only folder 403, invalid 400 (a refused definition also carries its `location`), with
// the message of the package's own errors (safe to show). Other errors (the engine's HTTP exceptions, backlog and bridge
// errors that a run action passes on) are left to the other filters.
export function describeWorkflowError(exception: WorkflowError): { statusCode: number; message: string; location?: WorkflowErrorLocation } {
  if (exception instanceof WorkflowNotFoundError) return { statusCode: HttpStatus.NOT_FOUND, message: exception.message };
  if (exception instanceof WorkflowConflictError) return { statusCode: HttpStatus.CONFLICT, message: exception.message };
  if (exception instanceof WorkflowReadOnlyError) return { statusCode: HttpStatus.FORBIDDEN, message: exception.message };
  if (exception instanceof WorkflowDefinitionError) return { statusCode: HttpStatus.BAD_REQUEST, message: exception.message, location: exception.location };
  return { statusCode: HttpStatus.BAD_REQUEST, message: exception.message };
}

@Catch(WorkflowNotFoundError, WorkflowConflictError, WorkflowInvalidError, WorkflowReadOnlyError, WorkflowDefinitionError)
export class WorkflowErrorFilter implements ExceptionFilter {
  catch(exception: WorkflowError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const path = http.getRequest<Request>().originalUrl;
    const { statusCode, message, location } = describeWorkflowError(exception);
    http.getResponse<Response>().status(statusCode).json({ statusCode, message, ...(location && { location }), path });
  }
}
