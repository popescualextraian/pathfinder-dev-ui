import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { OptionalSessionName } from './session-name';
import { MAX_TEXT_LENGTH } from './prompt.dto';

export class AnswerDto {
  @IsString()
  @MaxLength(MAX_TEXT_LENGTH)
  @Matches(/\S/, { message: 'text must not be blank' })
  @IsNotEmpty()
  text!: string;

  // Id of the open question; the oldest open one when absent.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  question?: string;

  // Session to look in for the oldest open question when `question` is absent; the question's own session otherwise.
  @OptionalSessionName()
  session?: string;
}
