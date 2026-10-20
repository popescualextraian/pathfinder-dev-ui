import { isAbsolute } from 'node:path';

// Injection token of the validated workflow configuration.
export const WORKFLOW_CONFIG = Symbol('WORKFLOW_CONFIG');

export interface WorkflowConfig {
  // WORKFLOWS_DIR: one YAML file per workflow definition.
  dir: string;
  // WORKFLOWS_DATA_DIR: one JSON file per workflow run.
  dataDir: string;
}

// Messages name variables only, never their values.
export class WorkflowConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid workflow configuration: ${problems.join('; ')}`);
    this.name = 'WorkflowConfigError';
  }
}

const value = (env: NodeJS.ProcessEnv, name: string): string | undefined => env[name]?.trim() || undefined;

// Workflows drive backlog items, so they are on only with the backlog: BACKLOG_CONFIG and WORKFLOWS_DIR both set.
// WORKFLOWS_DIR without BACKLOG_CONFIG is ignored (no routes, no error).
export function workflowsEnabled(env: NodeJS.ProcessEnv): boolean {
  return value(env, 'BACKLOG_CONFIG') !== undefined && value(env, 'WORKFLOWS_DIR') !== undefined;
}

// Read when workflows are on; both directories are required and absolute.
export function loadWorkflowConfig(env: NodeJS.ProcessEnv = process.env): WorkflowConfig {
  const problems: string[] = [];
  const dir = (name: string): string => {
    const v = value(env, name);
    if (v === undefined) problems.push(`${name} is required`);
    else if (!isAbsolute(v)) problems.push(`${name} must be an absolute path`);
    return v ?? '';
  };
  const config = { dir: dir('WORKFLOWS_DIR'), dataDir: dir('WORKFLOWS_DATA_DIR') };
  if (problems.length > 0) throw new WorkflowConfigError(problems);
  return config;
}
