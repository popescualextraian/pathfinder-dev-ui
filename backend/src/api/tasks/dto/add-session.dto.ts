import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { MAX_TEXT_LENGTH } from './prompt.dto';
import { SESSION_NAME } from './session-name';
import { MODEL_NAME, MODEL_NAME_MESSAGE } from './start-task.dto';

export class AddSessionDto {
  @IsString()
  @Matches(SESSION_NAME, { message: 'name must be 1 to 32 characters of a-z, 0-9, _ and -, starting with a letter or digit' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(MODEL_NAME, { message: MODEL_NAME_MESSAGE })
  model?: string;

  // Name of the session to copy the conversation from.
  @IsOptional()
  @IsString()
  @Matches(SESSION_NAME, { message: 'forkFrom must be a session name' })
  forkFrom?: string;

  // First prompt of the new session.
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_LENGTH)
  @Matches(/\S/, { message: 'prompt must not be blank' })
  @IsNotEmpty()
  prompt?: string;
}
