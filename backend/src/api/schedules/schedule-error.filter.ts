import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ScheduleInvalidError, ScheduleNotFoundError } from '../../schedule';

// Invalid input 400 with the field it is about, unknown schedule 404; the messages are the package's own (safe to show).
@Catch(ScheduleNotFoundError, ScheduleInvalidError)
export class ScheduleErrorFilter implements ExceptionFilter {
  catch(exception: ScheduleNotFoundError | ScheduleInvalidError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const path = http.getRequest<Request>().originalUrl;
    const response = http.getResponse<Response>();
    if (exception instanceof ScheduleInvalidError) {
      const statusCode = HttpStatus.BAD_REQUEST;
      response.status(statusCode).json({ statusCode, message: exception.message, field: exception.field, path });
      return;
    }
    const statusCode = HttpStatus.NOT_FOUND;
    response.status(statusCode).json({ statusCode, message: exception.message, path });
  }
}
