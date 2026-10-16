import { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './commons/all-exceptions.filter';
import { FRONTEND_DIR } from './commons/frontend-dir';
import { LoggingInterceptor } from './commons/logging.interceptor';
import { SpaFallbackFilter } from './commons/spa-fallback.filter';
import { createValidationPipe } from './commons/validation.pipe';

/** Global prefix, pipe, interceptor and filter; shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(), new SpaFallbackFilter(FRONTEND_DIR));
}
