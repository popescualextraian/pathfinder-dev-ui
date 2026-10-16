import { Controller, Get } from '@nestjs/common';
import { SystemInfo, SystemService } from '../../service/system/system.service';

@Controller('system')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('info')
  getInfo(): SystemInfo {
    return this.system.getInfo();
  }
}
