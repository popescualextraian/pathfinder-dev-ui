import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { WorkflowDefinitionFileRepository } from '../../../src/workflow/repository/workflow-definition-file.repository';

const root = join(__dirname, '../../../..');

describe('workflows.example', () => {
  it('loads both examples against the lanes of backlog.example.yaml without refusals', async () => {
    const lanes: { id: string }[] = parse(readFileSync(join(root, 'backlog.example.yaml'), 'utf8')).lanes;
    const stages = lanes.map((l) => l.id);
    const repo = new WorkflowDefinitionFileRepository(join(root, 'workflows.example'), { stages: () => stages });
    const r = await repo.list();
    expect(r.refused).toEqual([]);
    expect(r.definitions.map((d) => d.id)).toEqual(['implement-review', 'plan-implement-review']);
    expect(r.definitions.find((d) => d.id === 'implement-review')!.steps.map((s) => s.gate)).toEqual(['auto', 'human']);
  });
});
