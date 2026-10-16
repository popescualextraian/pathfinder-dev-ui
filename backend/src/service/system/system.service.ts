import { Injectable } from '@nestjs/common';
import { PackageInfo, PackageInfoRepository } from '../../repository/system/package-info.repository';

export interface SystemInfo extends PackageInfo {
  uptimeSeconds: number;
}

@Injectable()
export class SystemService {
  constructor(private readonly packageInfo: PackageInfoRepository) {}

  getInfo(): SystemInfo {
    return { ...this.packageInfo.read(), uptimeSeconds: Math.floor(process.uptime()) };
  }
}
