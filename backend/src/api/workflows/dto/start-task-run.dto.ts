import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  MAX_MODEL_LENGTH, MAX_TEXT_LENGTH, MAX_TITLE_LENGTH, MODEL_NAME, MODEL_NAME_MESSAGE,
} from '../../../commons/task-input-rules';
import { SafeId } from './safe-id';

// A plain task linked to a work item (no workflow). Limits as for POST /api/tasks.
export class StartTaskRunDto {
  @SafeId('itemId')
  itemId!: string;

  @IsString()
  @MaxLength(MAX_TEXT_LENGTH)
  @Matches(/\S/, { message: 'prompt must not be blank' })
  @IsNotEmpty()
  prompt!: string;

  // Defaults to `#<id> <title>` of the item.
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  @Matches(/\S/, { message: 'title must not be blank' })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_MODEL_LENGTH)
  @Matches(MODEL_NAME, { message: MODEL_NAME_MESSAGE })
  model?: string;

  // A name from GET /api/repositories; the default repository when absent.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, { message: 'repository contains characters that are not allowed' })
  repository?: string;
}
