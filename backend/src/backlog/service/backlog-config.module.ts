import { Module } from '@nestjs/common';
import { BACKLOG_CONFIG, loadBacklogConfig } from './backlog-config';

// Provides the validated backlog config once; every module that needs it imports this module.
// Only imported when the component is on (BACKLOG_CONFIG set).
@Module({
  providers: [
    {
      provide: BACKLOG_CONFIG,
      useFactory: () => {
        const config = loadBacklogConfig();
        if (!config) throw new Error('The backlog is not enabled: BACKLOG_CONFIG is not set');
        return config;
      },
    },
  ],
  exports: [BACKLOG_CONFIG],
})
export class BacklogConfigModule {}
