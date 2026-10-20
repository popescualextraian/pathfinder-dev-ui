import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { TaskEventsService } from '../../engine';
import { SESSION_NAME, SESSION_NAME_MESSAGE } from './dto/session-name';

// Answers 404 for an unknown task or session (and 400 for a malformed session name) before a
// response is started (see TasksController.stream).
@Injectable()
export class TaskExistsGuard implements CanActivate {
  constructor(private readonly events: TaskEventsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const session = request.query?.session;
    if (session !== undefined && (typeof session !== 'string' || !SESSION_NAME.test(session))) {
      throw new BadRequestException(SESSION_NAME_MESSAGE);
    }
    await (session === undefined
      ? this.events.assertExists(String(request.params.id))
      : this.events.assertExists(String(request.params.id), session));
    return true;
  }
}
