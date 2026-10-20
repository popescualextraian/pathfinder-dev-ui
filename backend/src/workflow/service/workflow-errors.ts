// Errors of the workflow package; messages are safe to show to clients. The API maps them to HTTP
// (not found -> 404, conflict -> 409, invalid -> 400).
export class WorkflowNotFoundError extends Error {
  constructor(message = 'Workflow run not found') {
    super(message);
    this.name = 'WorkflowNotFoundError';
  }
}

export class WorkflowConflictError extends Error {
  constructor(message = 'The workflow run cannot do that now') {
    super(message);
    this.name = 'WorkflowConflictError';
  }
}

export class WorkflowInvalidError extends Error {
  constructor(message = 'Invalid workflow request') {
    super(message);
    this.name = 'WorkflowInvalidError';
  }
}

export class WorkflowReadOnlyError extends Error {
  constructor(message = 'The workflow folder is read-only') {
    super(message);
    this.name = 'WorkflowReadOnlyError';
  }
}
