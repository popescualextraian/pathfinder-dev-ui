// Errors of the schedule package; messages are safe to show to clients. The API maps them to HTTP
// (not found -> 404, invalid -> 400 with the field).
export class ScheduleNotFoundError extends Error {
  constructor(message = 'Schedule not found') {
    super(message);
    this.name = 'ScheduleNotFoundError';
  }
}

export class ScheduleInvalidError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'ScheduleInvalidError';
  }
}
