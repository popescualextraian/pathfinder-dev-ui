// Unknown repository, no model.json, unknown review: 404.
export class ArchitectureNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchitectureNotFoundError';
  }
}

// Invalid branch name or review slug: 400.
export class ArchitectureBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchitectureBadRequestError';
  }
}
