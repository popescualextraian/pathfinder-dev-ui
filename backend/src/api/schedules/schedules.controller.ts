import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseFilters } from '@nestjs/common';
import { ScheduleRecord, ScheduleResult, ScheduleRunner, SchedulePreview, ScheduleService, ScheduleSummary } from '../../schedule';
import { ScheduleErrorFilter } from './schedule-error.filter';

type Zoned<T> = T & { zone: string };

// The body is checked by the schedule package's validator (one set of rules, errors with the field), so it is passed on
// as it came. Neither tokens nor task records appear in any response.
@Controller('schedules')
@UseFilters(ScheduleErrorFilter)
export class SchedulesController {
  constructor(private readonly schedules: ScheduleService, private readonly runner: ScheduleRunner) {}

  @Get()
  async list(): Promise<Zoned<ScheduleSummary>[]> {
    return (await this.schedules.list()).map((s) => this.zoned(s));
  }

  // Declared before `:id` so `preview` is not taken for an id.
  @Post('preview')
  @HttpCode(200)
  preview(@Body() body: Record<string, unknown>): SchedulePreview {
    return this.schedules.preview(body?.when);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<Zoned<ScheduleRecord>> {
    return this.zoned(await this.schedules.get(id));
  }

  @Post()
  async create(@Body() body: unknown): Promise<Zoned<ScheduleRecord>> {
    return this.zoned(await this.schedules.create(body));
  }

  @Put(':id')
  async replace(@Param('id') id: string, @Body() body: unknown): Promise<Zoned<ScheduleRecord>> {
    return this.zoned(await this.schedules.replace(id, body));
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

  // The zone (SCHEDULES_TIMEZONE) goes with every schedule, so the UI shows times in it; it is not stored.
  private zoned<T extends object>(schedule: T): Zoned<T> {
    return { ...schedule, zone: this.schedules.zone };
  }
}
