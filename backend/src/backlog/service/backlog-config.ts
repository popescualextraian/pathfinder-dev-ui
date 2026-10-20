import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// Injection token of the validated backlog configuration.
export const BACKLOG_CONFIG = Symbol('BACKLOG_CONFIG');

export interface LaneConfig {
  id: string;
  title: string;
  trigger?: string;
  default?: boolean;
  gitlab?: { label?: string; state?: 'closed' };
}

// An item the memory connector starts with (lane: a lane id, default: the default lane).
export interface MemorySeedItem {
  title: string;
  description?: string;
  lane?: string;
}

export interface BacklogConfig {
  connector: string;
  gitlab?: { baseUrl: string; project: string; token: string };
  // Only for the memory connector (development and UI tests, see connector.factory.ts).
  memory?: { items: MemorySeedItem[] };
  pollSeconds: number;
  doneDays: number;
  dataDir: string;
  lanes: LaneConfig[];
}

// Messages name keys and variables only, never their values: the token is a secret.
export class BacklogConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid backlog configuration: ${problems.join('; ')}`);
    this.name = 'BacklogConfigError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function warnIfClearText(baseUrl: string): void {
  try {
    const url = new URL(baseUrl);
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      new Logger('BacklogConfig').warn('gitlab.baseUrl uses http: the token would travel in clear text');
    }
  } catch {
    // an unparsable URL is reported when it is used
  }
}

export function parseBacklogConfig(yamlText: string, env: NodeJS.ProcessEnv): BacklogConfig {
  const problems: string[] = [];
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch {
    throw new BacklogConfigError(['the config file is not valid YAML']);
  }
  const root: Obj = isObj(doc) ? doc : {};
  if (!isObj(doc)) problems.push('the config file must be a YAML mapping');

  const connector = str(root.connector) ?? '';
  if (!connector) problems.push('connector is required');

  const positive = (key: string, fallback: number): number => {
    const v = root[key];
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      problems.push(`${key} must be a positive integer`);
      return fallback;
    }
    return v;
  };
  const pollSeconds = positive('pollSeconds', 60);
  const doneDays = positive('doneDays', 14);

  const dataDir = str(env.BACKLOG_DATA_DIR) ?? '';
  if (!dataDir) problems.push('BACKLOG_DATA_DIR is required');

  let gitlab: BacklogConfig['gitlab'];
  if (connector === 'gitlab') {
    const g = isObj(root.gitlab) ? root.gitlab : {};
    if (!isObj(root.gitlab)) problems.push('gitlab is required for the gitlab connector');
    const baseUrl = str(g.baseUrl);
    const project = str(g.project);
    const tokenEnv = str(g.tokenEnv);
    if (!baseUrl) problems.push('gitlab.baseUrl is required');
    else warnIfClearText(baseUrl);
    if (!project) problems.push('gitlab.project is required');
    let token = '';
    if (!tokenEnv) problems.push('gitlab.tokenEnv is required');
    else {
      token = str(env[tokenEnv]) ?? '';
      if (!token) problems.push(`gitlab.tokenEnv: the variable ${tokenEnv} is not set`);
    }
    gitlab = { baseUrl: baseUrl ?? '', project: project ?? '', token };
  }

  const lanes: LaneConfig[] = [];
  if (!Array.isArray(root.lanes) || root.lanes.length === 0) problems.push('lanes must be a non-empty list');
  else {
    const seen = new Set<string>();
    const labels = new Set<string>();
    root.lanes.forEach((raw: unknown, i: number) => {
      const at = `lanes[${i}]`;
      if (!isObj(raw)) {
        problems.push(`${at} must be a mapping`);
        return;
      }
      const id = str(raw.id);
      const title = str(raw.title);
      if (!id) problems.push(`${at}.id is required`);
      else if (seen.has(id)) problems.push(`${at}.id is a duplicate`);
      else seen.add(id);
      if (!title) problems.push(`${at}.title is required`);
      const lane: LaneConfig = { id: id ?? '', title: title ?? '' };
      if (raw.trigger !== undefined) {
        const trigger = str(raw.trigger);
        if (!trigger) problems.push(`${at}.trigger must be a non-empty string`);
        else lane.trigger = trigger;
      }
      if (raw.default !== undefined) {
        if (typeof raw.default !== 'boolean') problems.push(`${at}.default must be true or false`);
        else if (raw.default) lane.default = true;
      }
      if (isObj(raw.gitlab)) {
        const m: NonNullable<LaneConfig['gitlab']> = {};
        const label = str(raw.gitlab.label);
        if (label) {
          m.label = label;
          if (label.includes(',')) problems.push(`${at}.gitlab.label must not contain a comma`);
          else if (labels.has(label)) problems.push(`${at}.gitlab.label is used by another lane`);
          else labels.add(label);
        }
        if (raw.gitlab.state !== undefined) {
          if (raw.gitlab.state === 'closed') m.state = 'closed';
          else problems.push(`${at}.gitlab.state must be closed`);
        }
        if (!m.label && !m.state) problems.push(`${at}.gitlab needs a label or state`);
        lane.gitlab = m;
      } else if (connector === 'gitlab') problems.push(`${at}.gitlab is required for the gitlab connector`);
      lanes.push(lane);
    });
    const closed = lanes.filter((l) => l.gitlab?.state === 'closed').length;
    if (closed > 1) problems.push(`lanes: at most one lane may have gitlab.state closed (found ${closed})`);
    const defaults = lanes.filter((l) => l.default).length;
    if (defaults !== 1) problems.push(`lanes: exactly one lane must be default (found ${defaults})`);
  }

  const memory = connector === 'memory' ? parseMemory(root.memory, new Set(lanes.map((l) => l.id)), problems) : undefined;

  if (problems.length > 0) throw new BacklogConfigError(problems);
  return { connector, gitlab, ...(memory && { memory }), pollSeconds, doneDays, dataDir, lanes };
}

function parseMemory(raw: unknown, laneIds: Set<string>, problems: string[]): BacklogConfig['memory'] {
  const list = isObj(raw) ? raw.items : undefined;
  if (list === undefined) return { items: [] };
  if (!Array.isArray(list)) {
    problems.push('memory.items must be a list');
    return { items: [] };
  }
  const items: MemorySeedItem[] = [];
  list.forEach((entry: unknown, i: number) => {
    const at = `memory.items[${i}]`;
    if (!isObj(entry)) {
      problems.push(`${at} must be a mapping`);
      return;
    }
    const title = str(entry.title);
    if (!title) problems.push(`${at}.title is required`);
    const item: MemorySeedItem = { title: title ?? '' };
    if (typeof entry.description === 'string') item.description = entry.description;
    if (entry.lane !== undefined) {
      const lane = str(entry.lane);
      if (!lane || !laneIds.has(lane)) problems.push(`${at}.lane is not a lane id`);
      else item.lane = lane;
    }
    items.push(item);
  });
  return { items };
}

// undefined when BACKLOG_CONFIG is unset: the backlog is optional.
export function loadBacklogConfig(env: NodeJS.ProcessEnv = process.env): BacklogConfig | undefined {
  const file = env.BACKLOG_CONFIG?.trim();
  if (!file) return undefined;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new BacklogConfigError(['BACKLOG_CONFIG: the file cannot be read']);
  }
  return parseBacklogConfig(text, env);
}
