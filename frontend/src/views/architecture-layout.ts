import type { ChangeKind, Model, ModelPart, PlanReview } from '../api/models';

export interface GridImpact {
  [componentId: string]: ChangeKind;
}

export type GridState = 'plain' | ChangeKind | 'dim';

export interface GridComponent {
  id: string;
  name: string;
  summary: string;
  part: string;
  layer: string;
  module: string | null;
  page: string;
  state: GridState;
}

export interface GridRow {
  layer: { id: string; name: string };
  /** One array per column. */
  cells: GridComponent[][];
  /** Components without a module in a part that has modules: drawn across the row. */
  spanning: GridComponent[];
}

export interface GridBlock {
  part: { id: string; name: string };
  /** `[{id: null, name: ''}]` when the part has no modules. */
  columns: { id: string | null; name: string }[];
  rows: GridRow[];
}

/** The sign and spoken label of each change kind (every coloured mark also has its sign). */
export const CHANGE_SIGN: Record<ChangeKind, string> = { new: '+', changed: '~', removed: '−' };
export const CHANGE_LABEL: Record<ChangeKind, string> = {
  new: 'new component',
  changed: 'changed component',
  removed: 'removed component',
};

/** The model's components plus the proposed new ones of a plan, in model order. */
function components(model: Model, changes: PlanReview['changes'] | undefined): Omit<GridComponent, 'state'>[] {
  const list: Omit<GridComponent, 'state'>[] = model.components.map((c) => ({
    id: c.id,
    name: c.name,
    summary: c.summary,
    part: c.part,
    layer: c.layer,
    module: c.module,
    page: c.page,
  }));
  const known = new Set(list.map((c) => c.id));
  for (const ch of changes ?? []) {
    if (ch.change !== 'new' || !ch.proposed || known.has(ch.component)) continue;
    const p = ch.proposed;
    list.push({ id: ch.component, name: p.name, summary: p.summary, part: p.part, layer: p.layer, module: p.module, page: '' });
    known.add(ch.component);
  }
  return list;
}

function columnsOf(part: ModelPart): GridBlock['columns'] {
  return part.modules.length ? part.modules.map((m) => ({ id: m.id, name: m.name })) : [{ id: null, name: '' }];
}

/**
 * The picture: one block per part (model order), module columns, layer rows (top to bottom).
 * With `changes`, touched components carry their change and the rest are `dim`.
 */
export function buildGrid(model: Model, changes?: PlanReview['changes']): GridBlock[] {
  const impact: GridImpact = {};
  for (const ch of changes ?? []) impact[ch.component] = ch.change;
  const all = components(model, changes).map(
    (c): GridComponent => ({ ...c, state: impact[c.id] ?? (changes ? 'dim' : 'plain') }),
  );

  return model.parts.map((part) => {
    const columns = columnsOf(part);
    const hasModules = part.modules.length > 0;
    const rows = part.layers.map((layer): GridRow => {
      const row: GridRow = { layer: { id: layer.id, name: layer.name }, cells: columns.map(() => []), spanning: [] };
      for (const c of all) {
        if (c.part !== part.id || c.layer !== layer.id) continue;
        if (!hasModules) {
          row.cells[0].push(c);
          continue;
        }
        const index = columns.findIndex((col) => col.id === c.module);
        if (index >= 0) row.cells[index].push(c);
        else row.spanning.push(c);
      }
      return row;
    });
    return { part: { id: part.id, name: part.name }, columns, rows };
  });
}

/** Ids connected to `id` in either direction, including the talks_to of a proposed component. */
export function connectedIds(model: Model, id: string, changes?: PlanReview['changes']): Set<string> {
  const out = new Set<string>();
  for (const c of model.connections) {
    if (c.from === id) out.add(c.to);
    if (c.to === id) out.add(c.from);
  }
  for (const ch of changes ?? []) {
    for (const t of ch.proposed?.talks_to ?? []) {
      if (ch.component === id) out.add(t.to);
      if (t.to === id) out.add(ch.component);
    }
  }
  out.delete(id);
  return out;
}
