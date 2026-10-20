import { applyDecorators } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';

// Ids of items and workflows: letters, digits, `.`, `_` and `-`, starting with a letter or digit (no paths).
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export const SafeId = (property: string) =>
  applyDecorators(IsString(), Matches(SAFE_ID, { message: `${property} must be 1 to 100 characters of letters, digits, ., _ and -, starting with a letter or digit` }));
