import { Controller, Get } from '@nestjs/common';

// Liveness for the compose healthcheck: touches nothing (no Docker, no storage).
@Controller('health')
export class HealthController {
  @Get()
  getHealth(): { ok: true } {
    return { ok: true };
  }
}
