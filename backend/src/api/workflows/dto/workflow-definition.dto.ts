import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { WORKFLOW_ID } from '../../../workflow';

// Shape only (types, presence of the lists); the rules (non-empty, names, placeholders, stages) are the service's,
// so the editor gets them as located errors.
export class SessionDefDto {
  @IsString() name!: string;
  @IsString() prompt!: string;
  @IsOptional() @IsString() fork?: string;
  @IsOptional() @IsString() model?: string;
}

export class StepDefDto {
  @IsString() id!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() stage?: string;
  @IsIn(['human', 'auto']) gate!: 'human' | 'auto';
  @IsArray() @ValidateNested({ each: true }) @Type(() => SessionDefDto) sessions!: SessionDefDto[];
  @IsOptional() @IsArray() @IsString({ each: true }) requires?: string[];
  @IsOptional() @IsString() exitPrompt?: string;
}

export class WorkflowDefinitionDto {
  @IsString() title!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => StepDefDto) steps!: StepDefDto[];
  @IsOptional() @IsString() doneStage?: string;
}

export class ValidateWorkflowDto {
  @IsObject() @ValidateNested() @Type(() => WorkflowDefinitionDto)
  definition!: WorkflowDefinitionDto;
}

export class CreateWorkflowDto extends ValidateWorkflowDto {
  @IsString() @Matches(WORKFLOW_ID, { message: `id must match ${WORKFLOW_ID}` })
  id!: string;
}

export class UpdateWorkflowDto extends ValidateWorkflowDto {
  // The version the editor read; the file must not have changed since.
  @IsString() @IsNotEmpty()
  version!: string;
}

export class VersionQueryDto {
  @IsString() @IsNotEmpty()
  version!: string;
}
