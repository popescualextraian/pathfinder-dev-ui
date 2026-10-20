import { applyDecorators } from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';

export const SESSION_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const SESSION_NAME_MESSAGE = 'session must be 1 to 32 characters of a-z, 0-9, _ and -, starting with a letter or digit';

// An optional session name on a body or query.
export const OptionalSessionName = () =>
  applyDecorators(IsOptional(), IsString(), Matches(SESSION_NAME, { message: SESSION_NAME_MESSAGE }));
