import { Body, Controller, Get, HttpCode, Param, Post, UseFilters } from '@nestjs/common';
import { WorkflowDefinitionsService, WorkflowGenerationSummary, WorkflowGenerationView, WorkflowGenerator } from '../../workflow';
import { BridgeErrorFilter } from '../tasks/bridge-error.filter';
import { GenerationChangesDto, GenerationParamsDto, StartGenerationDto } from './dto/workflow-generation.dto';
import { WorkflowErrorFilter } from './workflow-error.filter';

// Workflows written by an agent from a description. Declared before WorkflowsController in the module, so that
// `generations` is never taken for a workflow id. Every route is 403 when the workflows folder is not writable (the
// editor's answer): a draft could not be saved anyway. Start 201; the others 200 with the generation view. Unknown id
// 404, wrong state 409, bad input 400; the engine's errors on start (cap 409, ...) keep their mapping. Views carry no
// tokens and no internals.
@Controller('workflows/generations')
@UseFilters(WorkflowErrorFilter, BridgeErrorFilter)
export class WorkflowGenerationsController {
  constructor(
    private readonly generator: WorkflowGenerator,
    private readonly definitions: WorkflowDefinitionsService,
  ) {}

  @Post()
  async start(@Body() body: StartGenerationDto): Promise<WorkflowGenerationView> {
    await this.definitions.assertWritable();
    return this.generator.start(body.description, body.model === '' ? undefined : body.model);
  }

  // The open generations (no draft, `hasDraft` instead).
  @Get()
  async list(): Promise<WorkflowGenerationSummary[]> {
    await this.definitions.assertWritable();
    return this.generator.list();
  }

  @Get(':id')
  async get(@Param() params: GenerationParamsDto): Promise<WorkflowGenerationView> {
    await this.definitions.assertWritable();
    return this.generator.get(params.id);
  }

  @Post(':id/changes')
  @HttpCode(200)
  async changes(@Param() params: GenerationParamsDto, @Body() body: GenerationChangesDto): Promise<WorkflowGenerationView> {
    await this.definitions.assertWritable();
    return this.generator.requestChanges(params.id, body.text);
  }

  @Post(':id/discard')
  @HttpCode(200)
  async discard(@Param() params: GenerationParamsDto): Promise<WorkflowGenerationView> {
    await this.definitions.assertWritable();
    return this.generator.discard(params.id);
  }

  @Post(':id/saved')
  @HttpCode(200)
  async saved(@Param() params: GenerationParamsDto): Promise<WorkflowGenerationView> {
    await this.definitions.assertWritable();
    return this.generator.saved(params.id);
  }
}
