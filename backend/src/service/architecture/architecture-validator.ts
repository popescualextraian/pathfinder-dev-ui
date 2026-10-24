import type {
  FullReview, Model, PlanReview, Via,
} from './architecture-types';

export class ArchitectureFileError extends Error {
  constructor(readonly file: string, readonly detail: string) {
    super(`${file}: ${detail}`);
    this.name = 'ArchitectureFileError';
  }
}

const ID = /^[a-z0-9-]{1,60}$/;
const VIAS = ['call', 'rest', 'event', 'file', 'other'];
const SEVERITIES = ['error', 'warn', 'info'];
const STATUSES = ['open', 'fixed', 'accepted'];
const SOURCES = ['depcruise', 'llm', 'jscpd', 'knip'];
const SIZES = ['S', 'M', 'L'];
const CHANGES = ['new', 'changed', 'removed'];

type Obj = Record<string, unknown>;

class Reader {
  constructor(private readonly file: string) {}
  fail(path: string, message: string): never {
    throw new ArchitectureFileError(this.file, `${path}: ${message}`);
  }
  parse(text: string): Obj {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new ArchitectureFileError(this.file, 'is not valid JSON');
    }
    if (!isObj(value)) this.fail('$', 'must be an object');
    return value;
  }
  header(root: Obj, kind?: string): void {
    const v = root.version;
    if (typeof v === 'number') {
      if (v !== 1) throw new ArchitectureFileError(this.file, `version ${v} is not supported (this UI reads version 1)`);
    } else {
      this.fail('version', 'version must be 1');
    }
    if (kind && root.kind !== kind) this.fail('kind', `must be "${kind}"`);
  }
  obj(v: unknown, path: string): Obj {
    if (!isObj(v)) this.fail(path, 'must be an object');
    return v;
  }
  arr(v: unknown, path: string): unknown[] {
    if (!Array.isArray(v)) this.fail(path, 'must be an array');
    return v;
  }
  str(v: unknown, path: string, nonEmpty = false): string {
    if (typeof v !== 'string') this.fail(path, 'must be a string');
    if (nonEmpty && v.trim() === '') this.fail(path, 'must not be empty');
    return v;
  }
  oneOf(v: unknown, path: string, allowed: string[]): string {
    if (typeof v !== 'string' || !allowed.includes(v)) {
      this.fail(path, `must be one of ${allowed.join(', ')}`);
    }
    return v;
  }
  id(v: unknown, path: string): string {
    const s = this.str(v, path);
    if (!ID.test(s)) this.fail(path, 'must match [a-z0-9-]{1,60}');
    return s;
  }
  nullableStr(v: unknown, path: string): string | null {
    return v === null ? null : this.str(v, path);
  }
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseModel(file: string, text: string): Model {
  const r = new Reader(file);
  const root = r.parse(text);
  r.header(root);
  const style = r.obj(root.style, 'style');
  r.str(style.id, 'style.id', true);
  r.str(style.name, 'style.name', true);

  const partIds = new Set<string>();
  const layersOf = new Map<string, Set<string>>();
  const modulesOf = new Map<string, Set<string>>();
  r.arr(root.parts, 'parts').forEach((raw, i) => {
    const p = `parts[${i}]`;
    const part = r.obj(raw, p);
    const id = r.id(part.id, `${p}.id`);
    if (partIds.has(id)) r.fail(`${p}.id`, `duplicate id ${id}`);
    partIds.add(id);
    r.str(part.name, `${p}.name`);
    const layers = new Set<string>();
    const rawLayers = r.arr(part.layers, `${p}.layers`).map((l, j) => {
      const lp = `${p}.layers[${j}]`;
      const layer = r.obj(l, lp);
      const lid = r.id(layer.id, `${lp}.id`);
      if (layers.has(lid)) r.fail(`${lp}.id`, `duplicate id ${lid}`);
      layers.add(lid);
      r.str(layer.name, `${lp}.name`);
      return { layer, lp };
    });
    for (const { layer, lp } of rawLayers) {
      r.arr(layer.mayUse, `${lp}.mayUse`).forEach((u, k) => {
        const s = r.str(u, `${lp}.mayUse[${k}]`);
        if (!layers.has(s)) r.fail(`${lp}.mayUse[${k}]`, `unknown layer ${s} in part ${id}`);
      });
    }
    const modules = new Set<string>();
    r.arr(part.modules, `${p}.modules`).forEach((m, j) => {
      const mp = `${p}.modules[${j}]`;
      const mod = r.obj(m, mp);
      const mid = r.id(mod.id, `${mp}.id`);
      if (modules.has(mid)) r.fail(`${mp}.id`, `duplicate id ${mid}`);
      modules.add(mid);
      r.str(mod.name, `${mp}.name`);
    });
    layersOf.set(id, layers);
    modulesOf.set(id, modules);
  });

  const rawComponents = r.arr(root.components, 'components');
  const componentIds = new Set<string>();
  rawComponents.forEach((raw, i) => {
    const c = r.obj(raw, `components[${i}]`);
    const id = r.id(c.id, `components[${i}].id`);
    if (componentIds.has(id)) r.fail(`components[${i}].id`, `duplicate id ${id}`);
    componentIds.add(id);
  });
  rawComponents.forEach((raw, i) => {
    const p = `components[${i}]`;
    const c = raw as Obj;
    r.str(c.name, `${p}.name`);
    const part = r.str(c.part, `${p}.part`);
    if (!partIds.has(part)) r.fail(`${p}.part`, `unknown part ${part}`);
    const layer = r.str(c.layer, `${p}.layer`);
    if (!layersOf.get(part)!.has(layer)) r.fail(`${p}.layer`, `unknown layer ${layer} in part ${part}`);
    const mod = r.nullableStr(c.module, `${p}.module`);
    if (mod !== null && !modulesOf.get(part)!.has(mod)) r.fail(`${p}.module`, `unknown module ${mod} in part ${part}`);
    const parent = r.nullableStr(c.parent, `${p}.parent`);
    if (parent !== null && !componentIds.has(parent)) r.fail(`${p}.parent`, `unknown component ${parent}`);
    r.str(c.summary, `${p}.summary`);
    r.str(c.page, `${p}.page`);
  });

  r.arr(root.connections, 'connections').forEach((raw, i) => {
    const p = `connections[${i}]`;
    const c = r.obj(raw, p);
    for (const end of ['from', 'to'] as const) {
      const v = r.str(c[end], `${p}.${end}`);
      if (!componentIds.has(v)) r.fail(`${p}.${end}`, `unknown component ${v}`);
    }
    r.oneOf(c.via, `${p}.via`, VIAS);
  });
  return root as unknown as Model;
}

function checkFindings(r: Reader, list: unknown, path: string, opts: { source: boolean; known?: (c: string) => boolean }): void {
  r.arr(list, path).forEach((raw, i) => {
    const p = `${path}[${i}]`;
    const f = r.obj(raw, p);
    r.str(f.id, `${p}.id`);
    r.str(f.rule, `${p}.rule`);
    const comp = r.str(f.component, `${p}.component`);
    if (opts.known && !opts.known(comp)) r.fail(`${p}.component`, `unknown component ${comp}`);
    r.oneOf(f.severity, `${p}.severity`, SEVERITIES);
    if (opts.source) r.oneOf(f.source, `${p}.source`, SOURCES);
    r.str(f.text, `${p}.text`);
    r.oneOf(f.status, `${p}.status`, STATUSES);
    if (f.since !== undefined) r.str(f.since, `${p}.since`);
    if (f.alternative !== undefined) r.str(f.alternative, `${p}.alternative`);
  });
}

export function parseFullReview(file: string, text: string): FullReview {
  const r = new Reader(file);
  const root = r.parse(text);
  r.header(root, 'full');
  r.str(root.commit, 'commit');
  r.str(root.reviewedAt, 'reviewedAt');
  const comps = r.obj(root.components, 'components');
  for (const [k, v] of Object.entries(comps)) {
    r.str(r.obj(v, `components.${k}`).reviewedAt, `components.${k}.reviewedAt`);
  }
  checkFindings(r, root.findings, 'findings', { source: true });
  return root as unknown as FullReview;
}

export function parsePlanReview(file: string, text: string, model: Model): PlanReview {
  const r = new Reader(file);
  const root = r.parse(text);
  r.header(root, 'plan');
  for (const k of ['title', 'plan', 'baseCommit', 'reviewedAt', 'summary']) r.str(root[k], k);
  r.oneOf(root.size, 'size', SIZES);

  const inModel = new Set(model.components.map((c) => c.id));
  const parts = new Map(model.parts.map((p) => [p.id, p]));
  const newIds = new Set<string>();
  const changes = r.arr(root.changes, 'changes');
  changes.forEach((raw, i) => {
    const c = r.obj(raw, `changes[${i}]`);
    if (c.change === 'new' && typeof c.component === 'string') newIds.add(c.component);
  });
  changes.forEach((raw, i) => {
    const p = `changes[${i}]`;
    const c = raw as Obj;
    const id = r.str(c.component, `${p}.component`);
    const change = r.oneOf(c.change, `${p}.change`, CHANGES);
    r.str(c.line, `${p}.line`);
    if (change !== 'new') {
      if (!inModel.has(id)) r.fail(`${p}.component`, `unknown component ${id}`);
      return;
    }
    if (c.proposed === undefined) r.fail(`${p}.proposed`, `required for a new component (${id})`);
    const pr = r.obj(c.proposed, `${p}.proposed`);
    r.str(pr.name, `${p}.proposed.name`);
    r.str(pr.summary, `${p}.proposed.summary`);
    const part = r.str(pr.part, `${p}.proposed.part`);
    const mp = parts.get(part);
    if (!mp) return r.fail(`${p}.proposed.part`, `unknown part ${part}`);
    const layer = r.str(pr.layer, `${p}.proposed.layer`);
    if (!mp.layers.some((l) => l.id === layer)) r.fail(`${p}.proposed.layer`, `unknown layer ${layer} in part ${part}`);
    const mod = r.nullableStr(pr.module, `${p}.proposed.module`);
    if (mod !== null && !mp.modules.some((m) => m.id === mod)) r.fail(`${p}.proposed.module`, `unknown module ${mod} in part ${part}`);
    r.arr(pr.talks_to, `${p}.proposed.talks_to`).forEach((t, k) => {
      const tp = `${p}.proposed.talks_to[${k}]`;
      const to = r.str(r.obj(t, tp).to, `${tp}.to`);
      if (!inModel.has(to) && !newIds.has(to)) r.fail(`${tp}.to`, `unknown component ${to}`);
      r.oneOf((t as Obj).via as Via, `${tp}.via`, VIAS);
    });
  });

  checkFindings(r, root.findings, 'findings', {
    source: false,
    known: (c) => inModel.has(c) || newIds.has(c),
  });
  r.arr(root.passed, 'passed').forEach((v, i) => r.str(v, `passed[${i}]`));
  return root as unknown as PlanReview;
}
