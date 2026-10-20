import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseFilters } from '@nestjs/common';
import {
  Gate, RefusedWorkflow, StoredWorkflow, WorkflowDefinition, WorkflowDefinitionsService, WorkflowValidationError,
} from '../../workflow';
import { CreateWorkflowDto, UpdateWorkflowDto, ValidateWorkflowDto, VersionQueryDto } from './dto/workflow-definition.dto';
import { WorkflowErrorFilter } from './workflow-error.filter';

export interface WorkflowSummary {
  id: string;
  title: string;
  steps: Array<{ id: string; title: string; stage?: string; gate: Gate; sessions: string[] }>;
  doneStage?: string;
}

export interface WorkflowList {
  definitions: WorkflowSummary[];
  refused: RefusedWorkflow[];
  writable: boolean;
}

// The definitions in WORKFLOWS_DIR, read again on every call, and their editing. The list is what the board needs to
// offer and show them (no prompts); GET :id has everything. Writes are as open as the rest of the API.
@Controller('workflows')
@UseFilters(WorkflowErrorFilter)
export class WorkflowsController {
  constructor(private readonly definitions: WorkflowDefinitionsService) {}

  @Get()
  async list(): Promise<WorkflowList> {
    const { definitions, refused, writable } = await this.definitions.list();
    return {
      definitions: definitions.map(summary),
      refused: refused.map((r) => ({ file: r.file, error: r.error, ...(r.version !== undefined && { version: r.version }) })),
      writable,
    };
  }

  // `validate` and `refused/:file` are declared before `:id` so they are not taken for ids.
  @Post('validate')
  @HttpCode(200)
  async validate(@Body() body: ValidateWorkflowDto): Promise<{ errors: WorkflowValidationError[] }> {
    return { errors: await this.definitions.validate(body.definition) };
  }

  @Delete('refused/:file')
  @HttpCode(204)
  async deleteRefused(@Param('file') file: string, @Query() query: VersionQueryDto): Promise<void> {
    await this.definitions.deleteRefused(file, query.version);
  }

  @Get(':id')
  read(@Param('id') id: string): Promise<StoredWorkflow> {
    return this.definitions.read(id);
  }

  @Post()
  create(@Body() body: CreateWorkflowDto): Promise<StoredWorkflow> {
    return this.definitions.create(body.id, body.definition as WorkflowDefinition);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdateWorkflowDto): Promise<StoredWorkflow> {
    return this.definitions.update(id, body.definition as WorkflowDefinition, body.version);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Query() query: VersionQueryDto): Promise<void> {
    await this.definitions.delete(id, query.version);
  }
}

function summary(def: WorkflowDefinition): WorkflowSummary {
  const out: WorkflowSummary = {
    id: def.id,
    title: def.title,
    steps: def.steps.map((s) => ({
      id: s.id, title: s.title, ...(s.stage !== undefined && { stage: s.stage }), gate: s.gate, sessions: s.sessions.map((x) => x.name),
    })),
  };
  if (def.doneStage !== undefined) out.doneStage = def.doneStage;
  return out;
}
