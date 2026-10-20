import { Module } from '@nestjs/common';
import { BacklogServiceModule } from '../../backlog';
import { BacklogController } from './backlog.controller';

@Module({
  imports: [BacklogServiceModule],
  controllers: [BacklogController],
})
export class BacklogApiModule {}
