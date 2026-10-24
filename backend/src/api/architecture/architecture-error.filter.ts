import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ArchitectureBadRequestError, ArchitectureNotFoundError } from '../../service/architecture/architecture-errors';
import { ArchitectureFileError } from '../../service/architecture/architecture-validator';
import { RepositoryFileTooLargeError, RepositoryUnavailableError } from '../../service/architecture/repository-files';

type Handled =
  | ArchitectureNotFoundError
  | ArchitectureBadRequestError
  | ArchitectureFileError
  | RepositoryUnavailableError
  | RepositoryFileTooLargeError;

// Maps the architecture errors to HTTP. Their messages never carry a token, URL or path (safe to show).
@Catch(ArchitectureNotFoundError, ArchitectureBadRequestError, ArchitectureFileError, RepositoryUnavailableError, RepositoryFileTooLargeError)
export class ArchitectureErrorFilter implements ExceptionFilter {
  catch(exception: Handled, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const path = http.getRequest<Request>().originalUrl;
    const response = http.getResponse<Response>();
    if (exception instanceof ArchitectureFileError) {
      const statusCode = HttpStatus.UNPROCESSABLE_ENTITY;
      response.status(statusCode).json({ statusCode, message: exception.message, file: exception.file, path });
      return;
    }
    let statusCode = HttpStatus.BAD_GATEWAY;
    let file: string | undefined;
    if (exception instanceof ArchitectureNotFoundError) statusCode = HttpStatus.NOT_FOUND;
    else if (exception instanceof ArchitectureBadRequestError) statusCode = HttpStatus.BAD_REQUEST;
    else if (exception instanceof RepositoryFileTooLargeError) {
      statusCode = HttpStatus.UNPROCESSABLE_ENTITY;
      file = exception.path;
    }
    response.status(statusCode).json({ statusCode, message: exception.message, ...(file ? { file } : {}), path });
  }
}
