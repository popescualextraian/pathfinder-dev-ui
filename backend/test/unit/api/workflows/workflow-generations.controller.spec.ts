import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { GenerationChangesDto, GenerationParamsDto, StartGenerationDto } from '../../../../src/api/workflows/dto/workflow-generation.dto';
import { WorkflowGenerationsController } from '../../../../src/api/workflows/workflow-generations.controller';
import { WorkflowsApiModule } from '../../../../src/api/workflows/workflows-api.module';
import { WorkflowsController } from '../../../../src/api/workflows/workflows.controller';
import { WorkflowReadOnlyError } from '../../../../src/workflow';

const view = { id: 'G-20261021-abcdefgh', state: 'ready' };

function make(writable = true) {
  const generator = {
    start: jest.fn().mockResolvedValue(view),
    list: jest.fn().mockResolvedValue([view]),
    get: jest.fn().mockResolvedValue(view),
    requestChanges: jest.fn().mockResolvedValue(view),
    discard: jest.fn().mockResolvedValue(view),
    saved: jest.fn().mockResolvedValue(view),
  };
  const defs = {
    assertWritable: jest.fn().mockImplementation(async () => {
      if (!writable) throw new WorkflowReadOnlyError();
    }),
  };
  return { generator, defs, controller: new WorkflowGenerationsController(generator as never, defs as never) };
}

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  return (await validate(plainToInstance(cls, plain))).map((e) => e.property);
}

describe('WorkflowGenerationsController', () => {
  const id = { id: view.id };

  it('passes every action to the generator and returns its view', async () => {
    const { generator, controller } = make();
    expect(await controller.start({ description: 'Review flow', model: 'opus' })).toBe(view);
    expect(generator.start).toHaveBeenCalledWith('Review flow', 'opus');
    expect(await controller.list()).toEqual([view]);
    expect(await controller.get(id)).toBe(view);
    expect(await controller.changes(id, { text: 'More' })).toBe(view);
    expect(generator.requestChanges).toHaveBeenCalledWith(view.id, 'More');
    expect(await controller.discard(id)).toBe(view);
    expect(await controller.saved(id)).toBe(view);
    expect(generator.discard).toHaveBeenCalledWith(view.id);
    expect(generator.saved).toHaveBeenCalledWith(view.id);
  });

  it('treats an empty model as none', async () => {
    const { generator, controller } = make();
    await controller.start({ description: 'x', model: '' });
    await controller.start({ description: 'x' });
    expect(generator.start).toHaveBeenNthCalledWith(1, 'x', undefined);
    expect(generator.start).toHaveBeenNthCalledWith(2, 'x', undefined);
  });

  it('refuses every route with the read-only error and does nothing when the folder is not writable', async () => {
    const { generator, controller } = make(false);
    const calls = [
      () => controller.start({ description: 'x' }), () => controller.list(), () => controller.get(id),
      () => controller.changes(id, { text: 'x' }), () => controller.discard(id), () => controller.saved(id),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(WorkflowReadOnlyError);
    for (const fn of Object.values(generator)) expect(fn).not.toHaveBeenCalled();
  });

  it('is declared before WorkflowsController, so `generations` is not taken for a workflow id', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WorkflowGenerationsController)).toBe('workflows/generations');
    const controllers: unknown[] = Reflect.getMetadata('controllers', WorkflowsApiModule);
    expect(controllers.indexOf(WorkflowGenerationsController)).toBeLessThan(controllers.indexOf(WorkflowsController));
    const route = (name: string) => [Reflect.getMetadata(METHOD_METADATA, WorkflowGenerationsController.prototype[name as 'start']), Reflect.getMetadata(PATH_METADATA, WorkflowGenerationsController.prototype[name as 'start'])];
    expect(route('start')).toEqual([RequestMethod.POST, '/']);
    expect(route('saved')).toEqual([RequestMethod.POST, ':id/saved']);
  });
});

describe('generation DTOs', () => {
  it('accepts a description of 1 to 4000 characters and an optional model', async () => {
    expect(await errorsOf(StartGenerationDto, { description: 'x' })).toEqual([]);
    expect(await errorsOf(StartGenerationDto, { description: 'x'.repeat(4000), model: '' })).toEqual([]);
    expect(await errorsOf(StartGenerationDto, { description: 'x', model: 'opus' })).toEqual([]);
  });
  it.each([undefined, '', 5, 'x'.repeat(4001)])('rejects description %p', async (description) => {
    expect(await errorsOf(StartGenerationDto, { description })).toContain('description');
  });
  it('rejects a model that is not a string', async () => {
    expect(await errorsOf(StartGenerationDto, { description: 'x', model: 5 })).toContain('model');
  });
  it.each([undefined, '', 5, 'x'.repeat(4001)])('rejects changes text %p', async (text) => {
    expect(await errorsOf(GenerationChangesDto, { text })).toContain('text');
  });
  it.each(['../x', 'G-1', 'x', 'G-20261021-abcdefgh/..', 'G-20261021-ABCDEFGH', undefined])('rejects id %p', async (id) => {
    expect(await errorsOf(GenerationParamsDto, { id })).toContain('id');
  });
  it('accepts a generation id', async () => {
    expect(await errorsOf(GenerationParamsDto, { id: 'G-20261021-abcd1234' })).toEqual([]);
  });
});
