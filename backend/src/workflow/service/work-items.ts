export interface WorkItem {
  id: string;
  title: string;
  description: string;
  url: string;
  stage: string;
}

/** What the workflow package needs from the work items (implemented outside the package). */
export interface WorkItems {
  /** Resolves undefined for an unknown item. */
  get(itemId: string): Promise<WorkItem | undefined>;
  moveTo(itemId: string, stage: string): Promise<void>;
  /** Known stages (backlog: lane ids); when present, definitions are validated against them at load. */
  stages?(): Promise<string[]> | string[];
}

export const WORK_ITEMS = Symbol('WORK_ITEMS');
