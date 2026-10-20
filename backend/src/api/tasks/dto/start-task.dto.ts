import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { MAX_TEXT_LENGTH } from './prompt.dto';

// An https URL without embedded credentials (file:, ssh:, git@ forms and user:pw@ are refused).
export function IsHttpsUrlWithoutCredentials(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isHttpsUrlWithoutCredentials',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be an https URL without credentials`, ...options },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || value.length > 500 || /\s/.test(value)) return false;
          try {
            const url = new URL(value);
            return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
          } catch {
            return false;
          }
        },
      },
    });
}

// Fails when the property is set together with the other one.
function ExcludesProperty(other: string, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'excludesProperty',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} and ${other} exclude each other`, ...options },
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          return (args.object as Record<string, unknown>)[other] === undefined;
        },
      },
    });
}

export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:/[\]-]*$/;
export const MODEL_NAME_MESSAGE = 'model contains characters that are not allowed';

export class StartTaskDto {
  @IsString()
  @MaxLength(MAX_TEXT_LENGTH)
  @Matches(/\S/, { message: 'prompt must not be blank' })
  @IsNotEmpty()
  prompt!: string;

  // Defaults to the first line of the prompt.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/\S/, { message: 'title must not be blank' })
  title?: string;

  // A name from GET /api/repositories; the default repository when neither this nor repoUrl is given.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, { message: 'repository contains characters that are not allowed' })
  @ExcludesProperty('repoUrl')
  repository?: string;

  // Defaults to ENGINE_REPO_URL.
  @IsOptional()
  @IsHttpsUrlWithoutCredentials()
  repoUrl?: string;

  // Branch, tag or commit; cannot start with '-' (would look like an option to git).
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9_./][A-Za-z0-9_./-]*$/, { message: 'repoRef contains characters that are not allowed' })
  repoRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(MODEL_NAME, { message: MODEL_NAME_MESSAGE })
  model?: string;
}
