import { Controller, Get, UseFilters } from '@nestjs/common';
import { Gate, WorkflowDefinition, WorkflowRunner } from '../../workflow';
import { WorkflowErrorFilter } from './workflow-error.filter';

export interface WorkflowSummary {
  id: string;
  title: string;
  steps: Array<{ id: string; title: string; stage: string; gate: Gate; sessions: string[] }>;
  doneStage?: string;
}

export interface WorkflowList {
  definitions: WorkflowSummary[];
  refused: Array<{ file: string; error: string }>;
}

// The definitions in WORKFLOWS_DIR, read again on every call: what the board needs to offer and show them (no prompts).
@Controller('workflows')
@UseFilters(WorkflowErrorFilter)
export class WorkflowsController {
  constructor(private readonly runner: WorkflowRunner) {}

  @Get()
  async list(): Promise<WorkflowList> {
    const { definitions, refused } = await this.runner.definitions();
    return {
      definitions: definitions.map(summary),
      refused: refused.map((r) => ({ file: r.file, error: r.error })),
    };
  }
}

function summary(def: WorkflowDefinition): WorkflowSummary {
  const out: WorkflowSummary = {
    id: def.id,
    title: def.title,
    steps: def.steps.map((s) => ({ id: s.id, title: s.title, stage: s.stage, gate: s.gate, sessions: s.sessions.map((x) => x.name) })),
  };
  if (def.doneStage !== undefined) out.doneStage = def.doneStage;
  return out;
}
