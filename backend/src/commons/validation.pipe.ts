import { ValidationPipe } from '@nestjs/common';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, transform: true });
}
