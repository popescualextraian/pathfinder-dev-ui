/* eslint-disable @typescript-eslint/no-explicit-any -- tests mutate fixture JSON freely */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ArchitectureFileError, parseFullReview, parseModel, parsePlanReview,
} from '../../../../src/service/architecture/architecture-validator';

const DIR = join(__dirname, '../../../fixtures/architecture');
const text = (f: string) => readFileSync(join(DIR, f), 'utf8');
const json = (f: string) => JSON.parse(text(f));
const model = () => parseModel('model.json', text('model.json'));

function mutated(f: string, fn: (m: any) => void): string {
  const m = json(f);
  fn(m);
  return JSON.stringify(m);
}
function expectDetail(fn: () => unknown, ...parts: string[]) {
  let err: unknown;
  try { fn(); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(ArchitectureFileError);
  for (const p of parts) expect((err as Error).message).toContain(p);
}

describe('fixtures', () => {
  it('pass', () => {
    expect(model().parts).toHaveLength(2);
    expect(parseModel('o.json', text('one-part-model.json')).parts).toHaveLength(1);
    expect(parseFullReview('full.json', text('full.json')).kind).toBe('full');
    expect(parsePlanReview('a.json', text('2026-10-20-gift-cards.json'), model()).changes).toHaveLength(4);
    expect(parsePlanReview('b.json', text('2026-10-22-move-catalog.json'), model()).kind).toBe('plan');
  });
  it('refuses version 2', () => {
    expectDetail(() => parseModel('m.json', text('invalid/model-version-2.json')), 'm.json: version 2 is not supported (this UI reads version 1)');
  });
  it('refuses an unknown component in a plan', () => {
    expectDetail(() => parsePlanReview('p.json', text('invalid/plan-unknown-component.json'), model()), 'changes[0].component', 'invoice-service');
  });
});

describe('parseModel rules', () => {
  const bad = (fn: (m: any) => void, ...parts: string[]) =>
    expectDetail(() => parseModel('m.json', mutated('model.json', fn)), ...parts);
  it('not JSON', () => expectDetail(() => parseModel('m.json', '{nope'), 'm.json: is not valid JSON'));
  it('version missing / not a number', () => {
    bad((m) => { delete m.version; }, 'version must be 1');
    bad((m) => { m.version = '1'; }, 'version must be 1');
  });
  it('empty style name', () => bad((m) => { m.style.name = ' '; }, 'style.name'));
  it('bad id', () => bad((m) => { m.components[0].id = 'Bad_Id'; }, 'components[0].id'));
  it('unknown layer in component', () => bad((m) => { m.components[0].layer = 'nope'; }, 'components[0].layer', 'nope'));
  it('unknown part / module', () => {
    bad((m) => { m.components[0].part = 'nope'; }, 'components[0].part');
    bad((m) => { m.components[0].module = 'nope'; }, 'components[0].module');
  });
  it('null module is fine', () => {
    expect(() => parseModel('m.json', mutated('model.json', (m) => { m.components[0].module = null; }))).not.toThrow();
  });
  it('duplicate component id', () => bad((m) => { m.components[1].id = m.components[0].id; }, 'components[1].id', 'duplicate'));
  it('duplicate part / layer / module', () => {
    bad((m) => { m.parts[1].id = m.parts[0].id; }, 'parts[1].id');
    bad((m) => { m.parts[0].layers[1].id = m.parts[0].layers[0].id; }, 'parts[0].layers[1].id');
    bad((m) => { m.parts[0].modules[1].id = m.parts[0].modules[0].id; }, 'parts[0].modules[1].id');
  });
  it('unknown parent', () => bad((m) => { m.components[0].parent = 'ghost'; }, 'components[0].parent'));
  it('connection to unknown id', () => bad((m) => { m.connections[0].to = 'ghost'; }, 'connections[0].to', 'ghost'));
  it('bad via', () => bad((m) => { m.connections[0].via = 'smoke'; }, 'connections[0].via'));
  it('mayUse of another part', () => bad((m) => { m.parts[0].layers[0].mayUse = ['service']; }, 'mayUse[0]', 'service'));
  it('five parts are fine', () => {
    const t = mutated('one-part-model.json', (m) => {
      const base = m.parts[0];
      m.parts = [1, 2, 3, 4, 5].map((n) => ({ ...base, id: `p${n}`, name: `P${n}` }));
      m.components = m.components.map((c: any) => ({ ...c, part: 'p1' }));
    });
    expect(parseModel('m.json', t).parts).toHaveLength(5);
  });
});

describe('parseFullReview rules', () => {
  const bad = (fn: (m: any) => void, ...parts: string[]) =>
    expectDetail(() => parseFullReview('f.json', mutated('full.json', fn)), ...parts);
  it('kind must match', () => bad((m) => { m.kind = 'plan'; }, 'kind'));
  it('enums', () => {
    bad((m) => { m.findings[0].severity = 'bad'; }, 'findings[0].severity');
    bad((m) => { m.findings[0].status = 'bad'; }, 'findings[0].status');
    bad((m) => { m.findings[0].source = 'bad'; }, 'findings[0].source');
  });
  it('allows unknown component ids', () => {
    expect(() => parseFullReview('f.json', mutated('full.json', (m) => { m.findings[0].component = 'ghost'; }))).not.toThrow();
  });
});

describe('parsePlanReview rules', () => {
  const gift = '2026-10-20-gift-cards.json';
  const bad = (fn: (m: any) => void, ...parts: string[]) =>
    expectDetail(() => parsePlanReview('p.json', mutated(gift, fn), model()), ...parts);
  it('new change without proposed', () => bad((m) => { delete m.changes[0].proposed; }, 'changes[0].proposed'));
  it('proposed with unknown layer', () => bad((m) => { m.changes[0].proposed.layer = 'nope'; }, 'changes[0].proposed.layer', 'nope'));
  it('proposed with unknown module', () => bad((m) => { m.changes[0].proposed.module = 'nope'; }, 'proposed.module'));
  it('bad size', () => bad((m) => { m.size = 'XL'; }, 'size'));
  it('bad change', () => bad((m) => { m.changes[1].change = 'broken'; }, 'changes[1].change'));
  it('finding for unknown component', () => bad((m) => { m.findings[0].component = 'ghost'; }, 'findings[0].component', 'ghost'));
  it('finding may name a new component', () => {
    expect(() => parsePlanReview('p.json', mutated(gift, (m) => { m.findings[0].component = 'gift-card-service'; }), model())).not.toThrow();
  });
  it('bad talks_to via', () => bad((m) => { m.changes[0].proposed.talks_to[0].via = 'x'; }, 'talks_to[0].via'));
});
