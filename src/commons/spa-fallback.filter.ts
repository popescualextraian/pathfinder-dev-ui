import { ArgumentsHost, Catch, ExceptionFilter, NotFoundException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * Unknown GET paths outside /api get the frontend's index.html (client-side routing).
 * res.sendFile with a root, because without one send refuses paths with a dot directory.
 */
@Catch(NotFoundException)
export class SpaFallbackFilter implements ExceptionFilter {
  private readonly fallback = new AllExceptionsFilter();

  constructor(private readonly frontendDir: string) {}

  catch(exception: NotFoundException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    if (request.method === 'GET' && !/^\/api(\/|$)/.test(request.originalUrl)) {
      http.getResponse<Response>().sendFile('index.html', { root: this.frontendDir });
      return;
    }
    this.fallback.catch(exception, host);
  }
}
