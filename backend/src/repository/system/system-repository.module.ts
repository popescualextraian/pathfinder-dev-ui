import { Module } from '@nestjs/common';
import { PackageInfoRepository } from './package-info.repository';

@Module({
  providers: [PackageInfoRepository],
  exports: [PackageInfoRepository],
})
export class SystemRepositoryModule {}
