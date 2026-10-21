import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SCHEDULE_CONFIG } from '../../../../src/commons/schedule-config';
import {
  SCHEDULE_CLOCK, SCHEDULE_REPOSITORIES, SCHEDULE_REPOSITORY, SCHEDULED_TASKS, ScheduleRunner, ScheduleService, ScheduleServiceModule,
} from '../../../../src/schedule';
import { FakeClock, FakeScheduledTasks, MemoryScheduleRepository } from '../../../helpers/fake-schedule';

const repo = new MemoryScheduleRepository();
const tasks = new FakeScheduledTasks();

@Module({
  providers: [
    { provide: SCHEDULED_TASKS, useValue: tasks },
    { provide: SCHEDULE_REPOSITORY, useValue: repo },
    { provide: SCHEDULE_REPOSITORIES, useValue: { names: () => ['repo'] } },
    { provide: SCHEDULE_CONFIG, useValue: { dataDir: '/unused', timezone: 'UTC', tickSeconds: 30 } },
    { provide: SCHEDULE_CLOCK, useValue: new FakeClock(Date.parse('2026-10-21T10:00:00.000Z')) },
  ],
  exports: [SCHEDULED_TASKS, SCHEDULE_REPOSITORY, SCHEDULE_REPOSITORIES, SCHEDULE_CONFIG, SCHEDULE_CLOCK],
})
class FakesModule {}

describe('ScheduleServiceModule', () => {
  it('wires runner and service on the supplied tokens, with one lock set shared by both', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ScheduleServiceModule.register({ imports: [FakesModule] })] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const service = app.get(ScheduleService);
    const created = await service.create({ title: 'Hourly', prompt: 'p', repository: 'repo', when: { cron: '0 * * * *' } });
    expect(created.nextRunAt).toBe('2026-10-21T11:00:00+00:00');
    expect(await app.get(ScheduleRunner).runNow(created.id)).toMatchObject({ trigger: 'manual', outcome: 'running', taskId: 'T-1' });
    await app.close();
  });
});
