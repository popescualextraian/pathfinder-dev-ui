import type { WorkItem } from './work-items';

export interface PlaceholderContext {
  item: Pick<WorkItem, 'id' | 'title' | 'description' | 'url'>;
  step: { id: string };
  /** Unknown before the task exists (the first session's prompt): its placeholders become empty. */
  task?: { id: string; branch?: string };
}

/** Fills `{{item.*}}`, `{{task.id}}`, `{{task.branch}}`, `{{step.id}}` in one pass (filled values are not re-expanded). */
export function fillPlaceholders(text: string, ctx: PlaceholderContext): string {
  const values: Record<string, string> = {
    'item.id': ctx.item.id,
    'item.title': ctx.item.title,
    'item.description': ctx.item.description,
    'item.url': ctx.item.url,
    'task.id': ctx.task?.id ?? '',
    'task.branch': ctx.task?.branch ?? '',
    'step.id': ctx.step.id,
  };
  return text.replace(/\{\{\s*([a-z.]+)\s*\}\}/g, (whole, name: string) => values[name] ?? whole);
}
