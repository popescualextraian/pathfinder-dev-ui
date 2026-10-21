import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { MODEL_NAME, MODEL_NAME_MESSAGE } from '../../tasks/dto/start-task.dto';
import { GENERATION_ID, MAX_DESCRIPTION_LENGTH } from '../../../workflow';

export class StartGenerationDto {
  @IsString() @MinLength(1) @MaxLength(MAX_DESCRIPTION_LENGTH)
  description!: string;

  // The model of the agent; an empty string means none (the default model).
  @IsOptional() @ValidateIf((o: StartGenerationDto) => o.model !== '') @IsString() @MaxLength(100) @Matches(MODEL_NAME, { message: MODEL_NAME_MESSAGE })
  model?: string;
}

export class GenerationChangesDto {
  @IsString() @MinLength(1) @MaxLength(MAX_DESCRIPTION_LENGTH)
  text!: string;
}

// Keeps anything but a generation id (paths included) away from the service.
export class GenerationParamsDto {
  @IsString() @Matches(GENERATION_ID, { message: 'id is not a generation id' })
  id!: string;
}
