import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseFilters } from '@nestjs/common';
import { ScheduleRecord, ScheduleResult, ScheduleRunner, SchedulePreview, ScheduleService, ScheduleSummary } from '../../schedule';
import { ScheduleErrorFilter } from './schedule-error.filter';

// The body is checked by the schedule package's validator (one set of rules, errors with the field), so it is passed on
// as it came. Neither tokens nor task records appear in any response.
@Controller('schedules')
@UseFilters(ScheduleErrorFilter)
export class SchedulesController {
  constructor(private readonly schedules: ScheduleService, private readonly runner: ScheduleRunner) {}

  @Get()
  list(): Promise<ScheduleSummary[]> {
    return this.schedules.list();
  }

  // Declared before `:id` so `preview` is not taken for an id.
  @Post('preview')
  @HttpCode(200)
  preview(@Body() body: Record<string, unknown>): SchedulePreview {
    return this.schedules.preview(body?.when);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ScheduleRecord> {
    return this.schedules.get(id);
  }

  @Post()
  create(@Body() body: unknown): Promise<ScheduleRecord> {
    return this.schedules.create(body);
  }

  @Put(':id')
  replace(@Param('id') id: string, @Body() body: unknown): Promise<ScheduleRecord> {
    return this.schedules.replace(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.schedules.delete(id);
  }

  @Post(':id/run')
  @HttpCode(202)
  run(@Param('id') id: string): Promise<ScheduleResult> {
    return this.runner.runNow(id);
  }
}
