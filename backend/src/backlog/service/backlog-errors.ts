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

export class BacklogInvalidError extends Error {
  constructor(message = 'Invalid backlog request') {
    super(message);
    this.name = 'BacklogInvalidError';
  }
}

// Text that is safe to log or send to clients: the message of our own errors, otherwise only the error class.
export function safeMessage(error: unknown): string {
  if (error instanceof BacklogNotFoundError || error instanceof BacklogConflictError || error instanceof BacklogUnreachableError || error instanceof BacklogInvalidError) return error.message;
  return `unexpected ${error instanceof Error ? error.name : 'error'}`;
}
