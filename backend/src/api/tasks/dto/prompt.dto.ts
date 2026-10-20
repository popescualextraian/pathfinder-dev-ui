import { OptionalSessionName } from './session-name';
import { IsNotEmpty, IsString, MaxLength, Matches } from 'class-validator';

export const MAX_TEXT_LENGTH = 20_000;

export class PromptDto {
  @IsString()
  @MaxLength(MAX_TEXT_LENGTH)
  @Matches(/\S/, { message: 'text must not be blank' })
  @IsNotEmpty()
  text!: string;

  // Target session; main when absent.
  @OptionalSessionName()
  session?: string;
}
