import { Inject, Injectable } from '@nestjs/common';
import { validateWorkflowDefinition, WorkflowDefinitionError } from './parse-workflow';
import type { WorkflowErrorLocation } from './parse-workflow';
import type { RefusedWorkflow, WorkflowDefinition } from './workflow-definition';
import { WORKFLOW_DEFINITION_REPOSITORY } from './workflow-definition.repository';
import type { StoredWorkflow, WorkflowDefinitionRepository } from './workflow-definition.repository';
import { WORK_ITEMS } from './work-items';
import type { WorkItems } from './work-items';

export interface WorkflowDefinitionList {
  definitions: WorkflowDefinition[];
  refused: RefusedWorkflow[];
  /** Version of each listed definition's file, by id. */
  versions?: Record<string, string>;
  /** Whether the folder accepts writes (every write is refused otherwise). */
  writable: boolean;
}

export type WorkflowValidationError = { message: string } & WorkflowErrorLocation;

// Reading and editing the definitions (the runner only reads them to start runs).
@Injectable()
export class WorkflowDefinitionsService {
  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY) private readonly defs: WorkflowDefinitionRepository,
    @Inject(WORK_ITEMS) private readonly items: WorkItems,
  ) {}

  async list(): Promise<WorkflowDefinitionList> {
    const [{ definitions, refused, versions }, writable] = await Promise.all([this.defs.list(), this.defs.writable()]);
    return { definitions, refused, ...(versions !== undefined && { versions }), writable };
  }

  read(id: string): Promise<StoredWorkflow> {
    return this.defs.read(id);
  }

  /** The rules of the one validator, stages included, without writing. Empty = valid; else the first error found. */
  async validate(definition: unknown): Promise<WorkflowValidationError[]> {
    const stages = this.items.stages ? await this.items.stages() : undefined;
    try {
      validateWorkflowDefinition('draft', definition, { stages });
      return [];
    } catch (e) {
      if (e instanceof WorkflowDefinitionError) return [{ message: e.message, ...e.location }];
      throw e;
    }
  }

  create(id: string, definition: WorkflowDefinition): Promise<StoredWorkflow> {
    return this.defs.save(id, definition);
  }

  update(id: string, definition: WorkflowDefinition, version: string): Promise<StoredWorkflow> {
    return this.defs.save(id, definition, version);
  }

  delete(id: string, version: string): Promise<void> {
    return this.defs.delete(id, version);
  }

  deleteRefused(file: string, version: string): Promise<void> {
    return this.defs.deleteRefused(file, version);
  }
}
