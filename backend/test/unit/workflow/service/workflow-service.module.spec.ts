import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WORK_ITEMS, WORKFLOW_DEFINITION_REPOSITORY, WORKFLOW_GENERATION_REPOSITORY, WORKFLOW_RUN_REPOSITORY, WORKFLOW_TASKS,
  WorkflowGenerationFileRepository, WorkflowGenerator, WorkflowRunFileRepository, WorkflowRunner, WorkflowRunUpdates, WorkflowServiceModule,
} from '../../../../src/workflow';
import { FakeDefinitions, FakeWorkflowTasks, FakeWorkItems } from '../../../helpers/fake-workflow';

describe('WorkflowServiceModule', () => {
  it('wires the runner and the generator from the tokens the importing app provides and reconciles on init', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wfmod-'));
    const tasks = new FakeWorkflowTasks();
    @Module({
      providers: [
        { provide: WORKFLOW_TASKS, useValue: tasks },
        { provide: WORK_ITEMS, useValue: new FakeWorkItems([{ id: '1', title: 'One', description: '', url: 'u', stage: 'todo' }]) },
        { provide: WORKFLOW_DEFINITION_REPOSITORY, useValue: new FakeDefinitions([]) },
        { provide: WORKFLOW_RUN_REPOSITORY, useValue: new WorkflowRunFileRepository(dir) },
        { provide: WORKFLOW_GENERATION_REPOSITORY, useValue: new WorkflowGenerationFileRepository(join(dir, 'generations')) },
      ],
      exports: [WORKFLOW_TASKS, WORK_ITEMS, WORKFLOW_DEFINITION_REPOSITORY, WORKFLOW_RUN_REPOSITORY, WORKFLOW_GENERATION_REPOSITORY],
    })
    class Adapters {}
    @Module({ imports: [WorkflowServiceModule.register({ imports: [Adapters] })] })
    class Root {}

    const app = await NestFactory.createApplicationContext(Root, { logger: false });
    try {
      expect(app.get(WorkflowRunner)).toBeInstanceOf(WorkflowRunner);
      expect(app.get(WorkflowRunUpdates)).toBeInstanceOf(WorkflowRunUpdates);
      expect(app.get(WorkflowGenerator)).toBeInstanceOf(WorkflowGenerator);
      expect(await app.get(WorkflowGenerator).list()).toEqual([]);
      expect(tasks.changes.observed).toBe(true); // subscribed on init
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
    expect(tasks.changes.observed).toBe(false);
  });
});
