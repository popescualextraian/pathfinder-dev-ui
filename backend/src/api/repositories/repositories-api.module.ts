import { Module } from '@nestjs/common';
import { RepositoriesServiceModule } from '../../service/repositories/repositories-service.module';
import { RepositoriesController } from './repositories.controller';

@Module({
  imports: [RepositoriesServiceModule],
  controllers: [RepositoriesController],
})
export class RepositoriesApiModule {}
