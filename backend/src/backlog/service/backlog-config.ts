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

export interface BacklogConfig {
  connector: string;
  gitlab?: { baseUrl: string; project: string; token: string };
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
        if (label) m.label = label;
        if (raw.gitlab.state !== undefined) {
          if (raw.gitlab.state === 'closed') m.state = 'closed';
          else problems.push(`${at}.gitlab.state must be closed`);
        }
        if (!m.label && !m.state) problems.push(`${at}.gitlab needs a label or state`);
        lane.gitlab = m;
      } else if (connector === 'gitlab') problems.push(`${at}.gitlab is required for the gitlab connector`);
      lanes.push(lane);
    });
    const defaults = lanes.filter((l) => l.default).length;
    if (defaults !== 1) problems.push(`lanes: exactly one lane must be default (found ${defaults})`);
  }

  if (problems.length > 0) throw new BacklogConfigError(problems);
  return { connector, gitlab, pollSeconds, doneDays, dataDir, lanes };
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
