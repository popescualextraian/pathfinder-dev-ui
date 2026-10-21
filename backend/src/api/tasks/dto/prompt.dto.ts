import { OptionalSessionName } from './session-name';
import { IsNotEmpty, IsString, MaxLength, Matches } from 'class-validator';
import { MAX_TEXT_LENGTH } from '../../../commons/task-input-rules';

export { MAX_TEXT_LENGTH } from '../../../commons/task-input-rules';

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
