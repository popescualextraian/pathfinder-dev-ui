import { loadWorkflowConfig, WorkflowConfigError, workflowsEnabled } from '../../../src/commons/workflow-config';

function errorOf(env: NodeJS.ProcessEnv): WorkflowConfigError {
  try {
    loadWorkflowConfig(env);
  } catch (e) {
    return e as WorkflowConfigError;
  }
  throw new Error('expected loadWorkflowConfig to throw');
}

describe('workflowsEnabled', () => {
  it('is on only when BACKLOG_CONFIG and WORKFLOWS_DIR are both set', () => {
    expect(workflowsEnabled({})).toBe(false);
    expect(workflowsEnabled({ WORKFLOWS_DIR: '/w' })).toBe(false);
    expect(workflowsEnabled({ BACKLOG_CONFIG: '/b.yaml' })).toBe(false);
    expect(workflowsEnabled({ BACKLOG_CONFIG: '/b.yaml', WORKFLOWS_DIR: '  ' })).toBe(false);
    expect(workflowsEnabled({ BACKLOG_CONFIG: ' ', WORKFLOWS_DIR: '/w' })).toBe(false);
    expect(workflowsEnabled({ BACKLOG_CONFIG: '/b.yaml', WORKFLOWS_DIR: '/w' })).toBe(true);
  });
});

describe('loadWorkflowConfig', () => {
  it('reads both directories, trimmed', () => {
    expect(loadWorkflowConfig({ WORKFLOWS_DIR: ' /etc/workflows ', WORKFLOWS_DATA_DIR: ' /var/lib/workflows ' }))
      .toEqual({ dir: '/etc/workflows', dataDir: '/var/lib/workflows' });
  });

  it('requires WORKFLOWS_DATA_DIR', () => {
    const error = errorOf({ WORKFLOWS_DIR: '/etc/workflows' });
    expect(error).toBeInstanceOf(WorkflowConfigError);
    expect(error.problems).toEqual(['WORKFLOWS_DATA_DIR is required']);
  });

  it('requires absolute paths and never prints the values', () => {
    const error = errorOf({ WORKFLOWS_DIR: 'secret-relative-dir', WORKFLOWS_DATA_DIR: 'secret-relative-data' });
    expect(error.problems).toEqual(['WORKFLOWS_DIR must be an absolute path', 'WORKFLOWS_DATA_DIR must be an absolute path']);
    expect(error.message).not.toContain('secret-relative');
    expect(error.message).toContain('Invalid workflow configuration');
  });

  it('requires WORKFLOWS_DIR', () => {
    expect(errorOf({ WORKFLOWS_DATA_DIR: '/d' }).problems).toEqual(['WORKFLOWS_DIR is required']);
  });
});
