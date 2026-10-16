import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { TaskEventsService } from '../../service/tasks/task-events.service';

// Answers 404 for an unknown task before a response is started (see TasksController.stream).
@Injectable()
export class TaskExistsGuard implements CanActivate {
  constructor(private readonly events: TaskEventsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    await this.events.assertExists(String(request.params.id));
    return true;
  }
}
