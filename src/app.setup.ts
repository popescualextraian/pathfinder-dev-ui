import { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './commons/all-exceptions.filter';
import { LoggingInterceptor } from './commons/logging.interceptor';
import { createValidationPipe } from './commons/validation.pipe';

/** Global prefix, pipe, interceptor and filter; shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
}
