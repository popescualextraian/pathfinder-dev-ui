import 'reflect-metadata';
import { WorkflowDefinition, WorkflowDefinitionError, WorkflowDefinitionsService, WorkflowReadOnlyError } from '../../../../src/workflow';
import { FakeDefinitions, FakeWorkItems } from '../../../helpers/fake-workflow';

const def = (over: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  id: 'ignored', title: 'T', steps: [{ id: 's', title: 'S', stage: 'todo', gate: 'auto', prompt: 'p {{item.id}}' }], ...over,
});

function make(stages?: string[]) {
  const repo = new FakeDefinitions([{ ...def(), id: 'one' }]);
  const items = new FakeWorkItems();
  if (stages) Object.assign(items, { stages: () => stages });
  return { repo, service: new WorkflowDefinitionsService(repo, items) };
}

describe('WorkflowDefinitionsService', () => {
  it('lists with the writable flag', async () => {
    const { repo, service } = make();
    expect(await service.list()).toEqual({ definitions: [{ ...def(), id: 'one' }], refused: [], writable: true });
    repo.isWritable = false;
    expect((await service.list()).writable).toBe(false);
  });

  it('reads a definition with its version', async () => {
    const { service } = make();
    expect(await service.read('one')).toEqual({ definition: { ...def(), id: 'one' }, version: '0' });
    await expect(service.read('nope')).rejects.toThrow('not found');
  });

  describe('validate', () => {
    it('is empty for a valid definition and does not write', async () => {
      const { repo, service } = make(['todo']);
      expect(await service.validate(def())).toEqual([]);
      expect((await repo.list()).definitions).toHaveLength(1);
    });

    it('returns the first error with its location', async () => {
      const { service } = make();
      const bad = def({ steps: [{ id: 'a', title: 'A', gate: 'auto', prompt: 'p', fork: 'zz' }] });
      expect(await service.validate(bad)).toEqual([{ message: expect.stringContaining('fork'), stepId: 'a', field: 'fork' }]);
    });

    it('checks the stages against the work items', async () => {
      const { service } = make(['other']);
      expect(await service.validate(def())).toEqual([expect.objectContaining({ stepId: 's', field: 'stage' })]);
    });

    it('rethrows errors that are not definition errors', async () => {
      const { service } = make();
      const items = { stages: () => { throw new Error('boom'); } } as never;
      await expect(new WorkflowDefinitionsService(make().repo, items).validate(def())).rejects.toThrow('boom');
      expect(service).toBeDefined();
    });
  });

  it('creates, updates and deletes through the repository', async () => {
    const { repo, service } = make();
    const created = await service.create('two', def());
    expect(created).toEqual({ definition: { ...def(), id: 'two' }, version: '1' });
    await expect(service.create('two', def())).rejects.toThrow('exists');
    const updated = await service.update('two', def({ title: 'New' }), '1');
    expect(updated.definition.title).toBe('New');
    await expect(service.update('two', def(), '1')).rejects.toThrow('changed');
    await service.delete('two', updated.version);
    expect((await repo.get('two'))).toBeUndefined();
  });

  it('passes read-only and refused-file deletes through', async () => {
    const { repo, service } = make();
    repo.isWritable = false;
    await expect(service.create('x', def())).rejects.toBeInstanceOf(WorkflowReadOnlyError);
    await expect(service.deleteRefused('bad.yaml', 'v')).rejects.toThrow('not found');
    expect(new WorkflowDefinitionError('m')).toBeInstanceOf(Error);
  });
});
