import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { GENERATION_ID, MAX_DESCRIPTION_LENGTH } from '../../../workflow';

export class StartGenerationDto {
  @IsString() @MinLength(1) @MaxLength(MAX_DESCRIPTION_LENGTH)
  description!: string;

  // The model of the agent; an empty string means none (the default model).
  @IsOptional() @IsString() @MaxLength(200)
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
