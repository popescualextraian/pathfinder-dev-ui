// Connector errors; messages are safe to show to clients (no tokens, no raw upstream bodies).
export class BacklogNotFoundError extends Error {
  constructor(message = 'Backlog item not found') {
    super(message);
    this.name = 'BacklogNotFoundError';
  }
}

export class BacklogConflictError extends Error {
  constructor(message = 'Backlog item changed in the source') {
    super(message);
    this.name = 'BacklogConflictError';
  }
}

export class BacklogUnreachableError extends Error {
  constructor(message = 'Backlog source is unreachable') {
    super(message);
    this.name = 'BacklogUnreachableError';
  }
}
