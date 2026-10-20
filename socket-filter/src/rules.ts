// The pure rule function of the filter: one request descriptor in, one decision out.
// Everything that is not explicitly allowed here is refused.
import { FilterConfig } from './config';
import { parseStrictJson } from './strict-json';

export const MAX_BODY_BYTES = 1024 * 1024;

export interface FilterRequest {
  method: string;
  /** The raw request target as received (path and query). */
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/** Send this request upstream. The path (with query) and body are rebuilt from validated values. */
export interface Forward {
  action: 'forward';
  method: string;
  path: string;
  body?: Buffer;
}

/** Inspect the named resource upstream first (GET inspectPath); forward only if it carries the kind label. */
export interface CheckLabel {
  action: 'check-label';
  resource: 'container' | 'volume';
  name: string;
  inspectPath: string;
  forward: Forward;
}

export interface Refuse {
  action: 'refuse';
  reason: string;
}

export type Decision = Forward | CheckLabel | Refuse;

class Refusal extends Error {}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

// Client-controlled text in a reason (and so in the log): printable ASCII only, short.
function safe(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, '?').slice(0, 64);
}

type Json = unknown;
type JsonObject = Record<string, Json>;

function isObject(value: Json): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(obj: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function sameJson(a: Json, b: Json): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- request target -----------------------------------------------------------------------------

type Params = Array<[string, string]>;

interface Target {
  prefix: string;
  path: string;
  params: Params;
}

function parseTarget(url: string): Target {
  if (!url.startsWith('/')) refuse('request target must be an absolute path');
  const q = url.indexOf('?');
  const rawPath = q < 0 ? url : url.slice(0, q);
  const rawQuery = q < 0 ? '' : url.slice(q + 1);
  // No percent-encoding, no other characters: the path must match a route literally.
  if (!/^[A-Za-z0-9/._-]+$/.test(rawPath)) refuse('path has characters that are not allowed');
  const m = /^(\/v1\.\d{1,3}(?=\/))?(\/.*)$/.exec(rawPath);
  if (!m) refuse('path not allowed');
  return { prefix: m[1] ?? '', path: m[2], params: parseQuery(rawQuery) };
}

// Like Go's url.ParseQuery (what the daemon uses), but strict: a bad pair refuses the request.
function parseQuery(raw: string): Params {
  const params: Params = [];
  for (const part of raw.split('&')) {
    if (part === '') continue;
    if (part.includes(';')) refuse('semicolon in query');
    const eq = part.indexOf('=');
    const rawKey = eq < 0 ? part : part.slice(0, eq);
    const rawValue = eq < 0 ? '' : part.slice(eq + 1);
    try {
      params.push([decodeURIComponent(rawKey.replace(/\+/g, ' ')), decodeURIComponent(rawValue.replace(/\+/g, ' '))]);
    } catch {
      refuse('bad percent-encoding in query');
    }
  }
  return params;
}

/**
 * Checks the query against the allowed keys. `single` keys may appear at most once and are returned;
 * `mirrored` keys are what docker-modem copies from the JSON body into the query (the daemon ignores
 * them): accepted in any number and dropped.
 */
function queryOf(params: Params, single: string[], mirrored: string[] = []): Map<string, string> {
  const values = new Map<string, string>();
  for (const [key, value] of params) {
    if (single.includes(key)) {
      if (values.has(key)) refuse(`query parameter ${safe(key)} repeated`);
      values.set(key, value);
    } else if (!mirrored.includes(key)) {
      refuse(`query parameter ${safe(key)} not allowed`);
    }
  }
  return values;
}

function buildPath(prefix: string, path: string, params: Params = []): string {
  if (params.length === 0) return prefix + path;
  return `${prefix}${path}?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
}

function bool(values: Map<string, string>, key: string): Params {
  const value = values.get(key);
  if (value === undefined) return [];
  if (!['true', 'false', '1', '0'].includes(value)) refuse(`query parameter ${key} must be a boolean`);
  return [[key, value]];
}

// ---- names and labels ---------------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

/** The task id inside a valid resource name, or a refusal. */
function taskIdOf(name: Json, config: FilterConfig): string {
  if (typeof name !== 'string' || !new RegExp(`^${escapeRegExp(config.namePrefix)}[A-Za-z0-9-]+$`).test(name)) {
    refuse('name not allowed');
  }
  return name.slice(config.namePrefix.length);
}

function checkLabels(labels: Json, taskId: string, config: FilterConfig): void {
  if (!isObject(labels)) refuse('Labels required');
  for (const [key, value] of Object.entries(labels)) {
    if (!key.startsWith(config.labelPrefix)) refuse(`label ${safe(key)} not allowed`);
    if (typeof value !== 'string') refuse(`label ${safe(key)} must be a string`);
  }
  if (labels[config.kindLabel.key] !== config.kindLabel.value) refuse('kind label missing');
  if (labels[`${config.labelPrefix}task`] !== taskId) refuse('task label must match the name');
}

function onlyKeys(obj: JsonObject, allowed: string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) refuse(`${where}key ${safe(key)} not allowed`);
  }
}

function parseBody(body: Buffer): JsonObject {
  if (body.length === 0) refuse('body required');
  let value: Json;
  try {
    value = parseStrictJson(body);
  } catch (error) {
    refuse((error as Error).message);
  }
  if (!isObject(value)) refuse('body must be a JSON object');
  return value;
}

function noBody(req: FilterRequest): void {
  if (req.body.length > 0) refuse('body not allowed');
}

// ---- endpoints ----------------------------------------------------------------------------------

const CONTAINER_ID = /^[0-9a-f]{64}$/;

const CONTAINER_KEYS = ['Image', 'name', 'Cmd', 'Labels', 'Env', 'HostConfig'];
const HOST_CONFIG_KEYS = ['Binds', 'NetworkMode', 'CapDrop', 'SecurityOpt'];
const VOLUME_KEYS = ['Name', 'Labels', 'Driver'];

function containerCreate(req: FilterRequest, target: Target, config: FilterConfig): Forward {
  const query = queryOf(target.params, ['name'], CONTAINER_KEYS.filter((k) => k !== 'name'));
  const name = query.get('name');
  const taskId = taskIdOf(name, config);
  const body = parseBody(req.body);
  onlyKeys(body, CONTAINER_KEYS, '');
  if (body.Image !== config.image) refuse('Image not allowed');
  if (own(body, 'name') && body.name !== name) refuse('name in body must match the query');
  if (!sameJson(body.Cmd, ['agentic-bridge'])) refuse('Cmd not allowed');
  checkLabels(body.Labels, taskId, config);
  if (own(body, 'Env') && !(Array.isArray(body.Env) && body.Env.every((e) => typeof e === 'string'))) refuse('Env must be a list of strings');
  const host = body.HostConfig;
  if (!isObject(host)) refuse('HostConfig required');
  onlyKeys(host, HOST_CONFIG_KEYS, 'HostConfig ');
  if (!sameJson(host.Binds, [`${name}:/task`])) refuse('Binds not allowed');
  if (host.NetworkMode !== config.network) refuse('NetworkMode not allowed');
  if (!sameJson(host.CapDrop, ['ALL'])) refuse('CapDrop must be ["ALL"]');
  if (!sameJson(host.SecurityOpt, ['no-new-privileges'])) refuse('SecurityOpt must be ["no-new-privileges"]');
  return { action: 'forward', method: 'POST', path: buildPath(target.prefix, '/containers/create', [['name', name as string]]), body: Buffer.from(JSON.stringify(body)) };
}

function volumeCreate(req: FilterRequest, target: Target, config: FilterConfig): Forward {
  queryOf(target.params, [], VOLUME_KEYS);
  const body = parseBody(req.body);
  onlyKeys(body, VOLUME_KEYS, '');
  const taskId = taskIdOf(body.Name, config);
  checkLabels(body.Labels, taskId, config);
  if (own(body, 'Driver') && body.Driver !== 'local') refuse('Driver not allowed');
  return { action: 'forward', method: 'POST', path: buildPath(target.prefix, '/volumes/create'), body: Buffer.from(JSON.stringify(body)) };
}

function containerList(req: FilterRequest, target: Target, config: FilterConfig): Forward {
  noBody(req);
  const query = queryOf(target.params, ['filters', 'all']);
  const kind = `${config.kindLabel.key}=${config.kindLabel.value}`;
  let filters: JsonObject = {};
  const raw = query.get('filters');
  if (raw !== undefined) {
    let parsed: Json;
    try {
      parsed = parseStrictJson(Buffer.from(raw, 'utf8'));
    } catch {
      refuse('filters is not valid JSON');
    }
    if (!isObject(parsed)) refuse('filters must be a JSON object');
    filters = parsed;
  }
  const values = Object.values(filters);
  const listForm = values.every((v) => Array.isArray(v) && v.every((s) => typeof s === 'string'));
  const mapForm = values.every((v) => isObject(v) && Object.values(v).every((b) => b === true));
  if (listForm) {
    const labels = (filters.label ?? []) as string[];
    filters.label = labels.includes(kind) ? labels : [...labels, kind];
  } else if (mapForm) {
    filters.label = { ...((filters.label ?? {}) as JsonObject), [kind]: true };
  } else {
    refuse('filters must be all lists of strings or all maps of true');
  }
  const params: Params = [['filters', JSON.stringify(filters)], ...bool(query, 'all')];
  return { action: 'forward', method: 'GET', path: buildPath(target.prefix, '/containers/json', params) };
}

function containerAction(req: FilterRequest, target: Target, name: string, action: string | undefined): Forward {
  const path = action === undefined ? `/containers/${name}` : `/containers/${name}/${action}`;
  const forward = (params: Params = []): Forward => ({ action: 'forward', method: req.method, path: buildPath(target.prefix, path, params) });
  switch (`${req.method} ${action ?? ''}`) {
    case 'POST start':
      noBody(req);
      queryOf(target.params, []);
      return forward();
    case 'POST stop': {
      const query = queryOf(target.params, ['t']);
      const t = query.get('t');
      if (t !== undefined && !/^\d{1,5}$/.test(t)) refuse('t must be a number of seconds');
      // docker-modem also sends the options as a JSON body; the daemon ignores it, so it is checked and dropped.
      if (req.body.length > 0) {
        const body = parseBody(req.body);
        onlyKeys(body, ['t'], '');
        if (t === undefined || body.t !== Number(t)) refuse('t in body must match the query');
      }
      return forward(t === undefined ? [] : [['t', t]]);
    }
    case 'DELETE ': {
      noBody(req);
      const query = queryOf(target.params, ['force', 'v']);
      const params = target.params.filter(([k]) => k === 'force' || k === 'v').flatMap(([k]) => bool(query, k));
      return forward(params);
    }
    case 'GET json':
      noBody(req);
      queryOf(target.params, []);
      return forward();
    case 'GET archive':
    case 'HEAD archive': {
      noBody(req);
      const path = queryOf(target.params, ['path']).get('path');
      if (!path) refuse('path required');
      return forward([['path', path]]);
    }
    default:
      refuse('endpoint not allowed');
  }
}

function route(req: FilterRequest, config: FilterConfig): Decision {
  if (req.body.length > MAX_BODY_BYTES) refuse('request body too large');
  const connection = String(req.headers.connection ?? '').toLowerCase();
  if (req.headers.upgrade !== undefined || connection.split(',').some((t) => t.trim() === 'upgrade')) {
    refuse('connection upgrade not allowed');
  }
  const target = parseTarget(req.url);
  const { path } = target;
  const method = req.method;
  const simple = (): Forward => {
    noBody(req);
    queryOf(target.params, []);
    return { action: 'forward', method, path: target.prefix + path };
  };

  if (path === '/_ping' && (method === 'GET' || method === 'HEAD')) return simple();
  if (path === '/version' && method === 'GET') return simple();
  if (path === '/containers/create' && method === 'POST') return containerCreate(req, target, config);
  if (path === '/volumes/create' && method === 'POST') return volumeCreate(req, target, config);
  if (path === '/containers/json' && method === 'GET') return containerList(req, target, config);

  const container = /^\/containers\/([^/]+)(?:\/(start|stop|json|archive))?$/.exec(path);
  if (container) {
    const name = container[1];
    // dockerode's createContainer returns a handle by id, so the launcher starts a new container by its full id;
    // that one action is allowed by id (the label check inspects the same id), everything else needs the name.
    if (!(CONTAINER_ID.test(name) && method === 'POST' && container[2] === 'start')) taskIdOf(name, config);
    const forward = containerAction(req, target, name, container[2]);
    return { action: 'check-label', resource: 'container', name, inspectPath: `${target.prefix}/containers/${name}/json`, forward };
  }

  const volume = /^\/volumes\/([^/]+)$/.exec(path);
  if (volume && method === 'DELETE') {
    const name = volume[1];
    taskIdOf(name, config);
    noBody(req);
    queryOf(target.params, []);
    const forward: Forward = { action: 'forward', method, path: `${target.prefix}/volumes/${name}` };
    return { action: 'check-label', resource: 'volume', name, inspectPath: `${target.prefix}/volumes/${name}`, forward };
  }

  refuse('endpoint not allowed');
}

export function decide(req: FilterRequest, config: FilterConfig): Decision {
  try {
    return route(req, config);
  } catch (error) {
    if (error instanceof Refusal) return { action: 'refuse', reason: error.message };
    throw error;
  }
}

/** Whether the upstream inspect body shows the resource with exactly this name (or full container id) and the kind label. */
export function inspectShowsKind(resource: 'container' | 'volume', name: string, body: unknown, config: FilterConfig): boolean {
  if (!isObject(body)) return false;
  const labels = resource === 'container' ? (isObject(body.Config) ? body.Config.Labels : undefined) : body.Labels;
  const sameResource =
    resource === 'volume' ? body.Name === name : CONTAINER_ID.test(name) ? body.Id === name : body.Name === `/${name}`;
  return sameResource && isObject(labels) && own(labels, config.kindLabel.key) && labels[config.kindLabel.key] === config.kindLabel.value;
}
