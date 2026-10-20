import { Injectable } from '@nestjs/common';
import { BacklogConflictError, BacklogNotFoundError, BacklogService } from '../../backlog';
import type { WorkItem, WorkItems } from '../../workflow';

/** The workflow package's work items: backlog items, their lane being the stage. */
@Injectable()
export class BacklogWorkItems implements WorkItems {
  constructor(private readonly backlog: BacklogService) {}

  async get(itemId: string): Promise<WorkItem | undefined> {
    try {
      const item = await this.backlog.get(itemId);
      return { id: item.id, title: item.title, description: item.description, url: item.url, stage: item.lane };
    } catch (error) {
      if (error instanceof BacklogNotFoundError) return undefined;
      throw error;
    }
  }

  // The board's write-through move from the item's lane. A conflict means the board's copy was stale: the backlog
  // reloads the item, so one retry starts from the lane the source reports. The workflow drives the card: it goes
  // to the stage from wherever it is.
  async moveTo(itemId: string, stage: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const { lane } = await this.backlog.get(itemId);
      if (lane === stage) return;
      try {
        await this.backlog.move(itemId, lane, stage);
        return;
      } catch (error) {
        if (!(error instanceof BacklogConflictError) || attempt >= 2) throw error;
      }
    }
  }

  stages(): string[] {
    return this.backlog.lanes().lanes.map((l) => l.id);
  }
}
