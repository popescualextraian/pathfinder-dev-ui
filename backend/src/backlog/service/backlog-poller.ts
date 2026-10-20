import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BACKLOG_CONFIG, BacklogConfig } from './backlog-config';
import { safeMessage } from './backlog-errors';
import { BacklogService } from './backlog.service';

// Refreshes the backlog once at start (without holding up startup) and then every pollSeconds.
@Injectable()
export class BacklogPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BacklogPoller.name);
  private timer?: NodeJS.Timeout;
  private round?: Promise<void>;

  constructor(
    private readonly backlog: BacklogService,
    @Inject(BACKLOG_CONFIG) private readonly config: Pick<BacklogConfig, 'pollSeconds'>,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.config.pollSeconds * 1000);
    this.timer.unref();
    void this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.round;
  }

  // A round that is still running when the next one is due is not doubled up.
  tick(): Promise<void> {
    this.round ??= this.backlog
      .refresh()
      .then(() => undefined)
      .catch((error: unknown) => this.logger.warn(`Refresh failed: ${safeMessage(error)}`))
      .finally(() => { this.round = undefined; });
    return this.round;
  }
}
