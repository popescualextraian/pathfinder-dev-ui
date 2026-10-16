import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
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
}
