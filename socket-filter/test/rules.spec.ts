import { stringify } from 'node:querystring';
import { FilterConfig } from '../src/config';
import { Decision, FilterRequest, MAX_APP_PORTS, MAX_BODY_BYTES, decide, inspectShowsKind } from '../src/rules';

const config: FilterConfig = {
  image: 'agentic-test:local',
  network: 'agentic-net',
  listen: '/tmp/filter.sock',
  upstream: '/tmp/upstream.sock',
  namePrefix: 'agentic-ui-task-',
  labelPrefix: 'agentic-ui.',
  kindLabel: { key: 'agentic-ui.kind', value: 'task' },
  debug: false,
};

const ID = 'T-20261020-327f';
const NAME = `agentic-ui-task-${ID}`;
const LABELS = { 'agentic-ui.task': ID, 'agentic-ui.kind': 'task' };

function request(method: string, url: string, body?: unknown, headers: FilterRequest['headers'] = {}): FilterRequest {
  const bytes = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return { method, url, headers, body: bytes };
}

// Like docker-modem: every option goes to the query (objects as JSON) and to the body.
function dockerodeQuery(opts: Record<string, unknown>): string {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts)) clone[k] = v && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v;
  return stringify(clone as Record<string, string>);
}

function containerBody(patch: Record<string, unknown> = {}, hostPatch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Image: 'agentic-test:local',
    name: NAME,
    Cmd: ['agentic-bridge'],
    Labels: LABELS,
    Env: ['AGENTIC_TASK_TOKEN=secret-token-value', 'AGENTIC_PROMPT=hello'],
    HostConfig: {
      Binds: [`${NAME}:/task`],
      NetworkMode: 'agentic-net',
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      ...hostPatch,
    },
    ...patch,
  };
}

// What the launcher adds for an image with apps: each port exposed and bound to 127.0.0.1 with HostPort "" (random).
function withPorts(ports: number[], bindings?: unknown, exposed?: unknown): Record<string, unknown> {
  return containerBody(
    { ExposedPorts: exposed ?? Object.fromEntries(ports.map((p) => [`${p}/tcp`, {}])) },
    { PortBindings: bindings ?? Object.fromEntries(ports.map((p) => [`${p}/tcp`, [{ HostIp: '127.0.0.1', HostPort: '' }]])) },
  );
}

function create(body: Record<string, unknown>, query = `name=${NAME}`): Decision {
  return decide(request('POST', `/containers/create?${query}`, body), config);
}

function volumeBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { Name: NAME, Labels: LABELS, ...patch };
}

function refused(decision: Decision): string {
  expect(decision.action).toBe('refuse');
  return decision.action === 'refuse' ? decision.reason : '';
}

describe('decide: allowed requests', () => {
  it.each([
    ['GET', '/_ping'],
    ['HEAD', '/_ping'],
    ['GET', '/version'],
    ['GET', '/v1.47/_ping'],
    ['GET', '/v1.24/version'],
  ])('forwards %s %s unchanged', (method, url) => {
    expect(decide(request(method, url), config)).toEqual({ action: 'forward', method, path: url });
  });

  it('forwards the container create of the launcher with only the name in the query and the validated body', () => {
    const body = containerBody();
    const decision = create(body, dockerodeQuery(body));
    expect(decision).toEqual({ action: 'forward', method: 'POST', path: `/containers/create?name=${NAME}`, body: Buffer.from(JSON.stringify(body)) });
  });

  it('forwards the app ports of the launcher: ExposedPorts and loopback PortBindings with a Docker-picked host port', () => {
    const body = withPorts([3000, 9229, 8080]);
    const decision = create(body, dockerodeQuery(body));
    expect(decision).toEqual({ action: 'forward', method: 'POST', path: `/containers/create?name=${NAME}`, body: Buffer.from(JSON.stringify(body)) });
  });

  it(`allows up to ${MAX_APP_PORTS} app ports, the binding keys in either order`, () => {
    const ports = Array.from({ length: MAX_APP_PORTS }, (_v, i) => 1 + i * 3000);
    expect(create(withPorts(ports)).action).toBe('forward');
    expect(create(withPorts([65535])).action).toBe('forward');
    expect(create(withPorts([3000], { '3000/tcp': [{ HostPort: '', HostIp: '127.0.0.1' }] })).action).toBe('forward');
  });

  it.each([
    ['GET', '/images/agentic-test:local/json'],
    ['GET', '/v1.47/images/agentic-test:local/json'],
  ])('forwards the inspect of FILTER_IMAGE (the launcher reads its apps label): %s %s', (method, url) => {
    expect(decide(request(method, url), config)).toEqual({ action: 'forward', method, path: url });
  });

  it('keeps the version prefix on create', () => {
    const decision = decide(request('POST', `/v1.45/containers/create?name=${NAME}`, containerBody()), config);
    expect(decision).toMatchObject({ action: 'forward', path: `/v1.45/containers/create?name=${NAME}` });
  });

  it('forwards the volume create of the launcher without the mirrored query', () => {
    const body = volumeBody();
    const decision = decide(request('POST', `/volumes/create?${dockerodeQuery(body)}`, body), config);
    expect(decision).toEqual({ action: 'forward', method: 'POST', path: '/volumes/create', body: Buffer.from(JSON.stringify(body)) });
  });

  it('allows the local volume driver', () => {
    expect(decide(request('POST', '/volumes/create', volumeBody({ Driver: 'local' })), config).action).toBe('forward');
  });

  it.each([
    ['POST', `/containers/${NAME}/start`, `/containers/${NAME}/start`],
    ['POST', `/containers/${NAME}/stop?t=10`, `/containers/${NAME}/stop?t=10`],
    ['POST', `/containers/${NAME}/stop`, `/containers/${NAME}/stop`],
    ['DELETE', `/containers/${NAME}?force=true&v=true`, `/containers/${NAME}?force=true&v=true`],
    ['GET', `/containers/${NAME}/json`, `/containers/${NAME}/json`],
    ['GET', `/containers/${NAME}/archive?path=%2Ftask%2Fledger.jsonl`, `/containers/${NAME}/archive?path=%2Ftask%2Fledger.jsonl`],
    ['HEAD', `/containers/${NAME}/archive?path=%2Fwork%2F.worktrees%2Fx`, `/containers/${NAME}/archive?path=%2Fwork%2F.worktrees%2Fx`],
    ['GET', `/v1.47/containers/${NAME}/json`, `/v1.47/containers/${NAME}/json`],
  ])('checks the kind label of the container before %s %s', (method, url, path) => {
    const prefix = url.startsWith('/v1.47') ? '/v1.47' : '';
    expect(decide(request(method, url), config)).toEqual({
      action: 'check-label',
      resource: 'container',
      name: NAME,
      inspectPath: `${prefix}/containers/${NAME}/json`,
      forward: { action: 'forward', method, path },
    });
  });

  it('accepts the stop timeout that dockerode mirrors into the body, and drops that body', () => {
    const decision = decide(request('POST', `/containers/${NAME}/stop?t=10`, { t: 10 }), config);
    expect(decision).toMatchObject({ action: 'check-label', forward: { action: 'forward', path: `/containers/${NAME}/stop?t=10` } });
    expect(decision.action === 'check-label' && decision.forward.body).toBeUndefined();
  });

  it('checks the kind label of the volume before removing it', () => {
    expect(decide(request('DELETE', `/volumes/${NAME}`), config)).toEqual({
      action: 'check-label',
      resource: 'volume',
      name: NAME,
      inspectPath: `/volumes/${NAME}`,
      forward: { action: 'forward', method: 'DELETE', path: `/volumes/${NAME}` },
    });
  });

  describe('container list', () => {
    function listFilters(url: string): unknown {
      const decision = decide(request('GET', url), config);
      expect(decision.action).toBe('forward');
      const path = decision.action === 'forward' ? decision.path : '';
      const query = new URLSearchParams(path.split('?')[1]);
      return JSON.parse(query.get('filters') ?? 'null');
    }

    it('forwards the launcher filter (kind label, running)', () => {
      const filters = { label: ['agentic-ui.kind=task'], status: ['running'] };
      expect(listFilters(`/containers/json?${dockerodeQuery({ filters })}`)).toEqual(filters);
    });

    it('adds the kind label when there is no filter', () => {
      expect(listFilters('/containers/json')).toEqual({ label: ['agentic-ui.kind=task'] });
      expect(listFilters('/containers/json?all=true')).toEqual({ label: ['agentic-ui.kind=task'] });
    });

    it('adds the kind label to other label filters (labels are and-ed)', () => {
      expect(listFilters(`/containers/json?filters=${encodeURIComponent('{"label":["x=y"]}')}`)).toEqual({ label: ['x=y', 'agentic-ui.kind=task'] });
      expect(listFilters(`/containers/json?filters=${encodeURIComponent('{"status":["running"]}')}`)).toEqual({ status: ['running'], label: ['agentic-ui.kind=task'] });
    });

    it('handles the map form', () => {
      expect(listFilters(`/containers/json?filters=${encodeURIComponent('{"label":{"x=y":true},"status":{"exited":true}}')}`))
        .toEqual({ label: { 'x=y': true, 'agentic-ui.kind=task': true }, status: { exited: true } });
    });

    it('keeps all', () => {
      const decision = decide(request('GET', '/containers/json?all=1'), config);
      expect(decision.action === 'forward' && new URLSearchParams(decision.path.split('?')[1]).get('all')).toBe('1');
    });

    it.each([
      ['unparseable', 'filters=%7Bnot-json'],
      ['array', `filters=${encodeURIComponent('["label"]')}`],
      ['non-string label', `filters=${encodeURIComponent('{"label":[1]}')}`],
      ['false in map form', `filters=${encodeURIComponent('{"label":{"x":false}}')}`],
      ['mixed forms', `filters=${encodeURIComponent('{"label":["x"],"status":{"running":true}}')}`],
      ['duplicate filter key', `filters=${encodeURIComponent('{"label":["x"],"label":["y"]}')}`],
      ['duplicate filters param', `filters=${encodeURIComponent('{}')}&filters=${encodeURIComponent('{}')}`],
      ['other query param', 'limit=5'],
      ['size', 'size=1'],
      ['bad all', 'all=yes'],
    ])('refuses %s', (_label, query) => {
      refused(decide(request('GET', `/containers/json?${query}`), config));
    });
  });
});

describe('decide: forbidden container create variants', () => {
  it.each([
    ['another image', containerBody({ Image: 'alpine' })],
    ['an image with a tag suffix', containerBody({ Image: 'agentic-test:local2' })],
    ['another command', containerBody({ Cmd: ['sh', '-c', 'id'] })],
    ['a command with extra args', containerBody({ Cmd: ['agentic-bridge', '--x'] })],
    ['an Entrypoint', containerBody({ Entrypoint: ['sh'] })],
    ['a null Entrypoint', containerBody({ Entrypoint: null })],
    ['a User', containerBody({ User: 'root' })],
    ['an unknown key', containerBody({ Volumes: { '/x': {} } })],
    ['a lower-case known key (Go matches it case-insensitively)', containerBody({ image: 'alpine' })],
    ['Privileged', containerBody({}, { Privileged: true })],
    ['privileged in lower case', containerBody({}, { privileged: true })],
    ['Privileged false (not in the allowlist)', containerBody({}, { Privileged: false })],
    ['a host-path bind', containerBody({}, { Binds: ['/:/host'] })],
    ['a host-path bind instead of the volume', containerBody({}, { Binds: [`/${NAME}:/task`] })],
    ['an extra bind', containerBody({}, { Binds: [`${NAME}:/task`, '/var/run/docker.sock:/var/run/docker.sock'] })],
    ['the volume with options', containerBody({}, { Binds: [`${NAME}:/task:rw,z`] })],
    ['a bind of another task volume', containerBody({}, { Binds: ['agentic-ui-task-other:/task'] })],
    ['no binds', containerBody({}, { Binds: [] })],
    ['Mounts', containerBody({}, { Mounts: [{ Type: 'bind', Source: '/', Target: '/host' }] })],
    ['CapAdd', containerBody({}, { CapAdd: ['SYS_ADMIN'] })],
    ['missing CapDrop', containerBody({}, { CapDrop: undefined })],
    ['CapDrop of one capability', containerBody({}, { CapDrop: ['NET_RAW'] })],
    ['another NetworkMode', containerBody({}, { NetworkMode: 'host' })],
    ['a missing NetworkMode', containerBody({}, { NetworkMode: undefined })],
    ['PortBindings', containerBody({}, { PortBindings: { '8765/tcp': [{ HostPort: '8765' }] } })],
    ['PidMode', containerBody({}, { PidMode: 'host' })],
    ['Devices', containerBody({}, { Devices: [{ PathOnHost: '/dev/sda' }] })],
    ['VolumesFrom', containerBody({}, { VolumesFrom: ['other'] })],
    ['another SecurityOpt', containerBody({}, { SecurityOpt: ['seccomp=unconfined'] })],
    ['an extra SecurityOpt', containerBody({}, { SecurityOpt: ['no-new-privileges', 'apparmor=unconfined'] })],
    ['missing SecurityOpt', containerBody({}, { SecurityOpt: undefined })],
    ['a HostConfig that is not an object', containerBody({ HostConfig: [] })],
    ['a missing HostConfig', containerBody({ HostConfig: undefined })],
    ['NetworkingConfig', containerBody({ NetworkingConfig: { EndpointsConfig: {} } })],
    ['a foreign label', containerBody({ Labels: { ...LABELS, 'com.example': 'x' } })],
    ['no kind label', containerBody({ Labels: { 'agentic-ui.task': ID } })],
    ['another kind', containerBody({ Labels: { ...LABELS, 'agentic-ui.kind': 'other' } })],
    ['a task label of another task', containerBody({ Labels: { ...LABELS, 'agentic-ui.task': 'T-other' } })],
    ['no task label', containerBody({ Labels: { 'agentic-ui.kind': 'task' } })],
    ['a non-string label', containerBody({ Labels: { ...LABELS, 'agentic-ui.x': 1 } })],
    ['an Env that is not a list of strings', containerBody({ Env: [{ a: 1 }] })],
    ['a body name that differs from the query', containerBody({ name: 'agentic-ui-task-other' })],
  ])('refuses %s', (_label, body) => {
    refused(create(JSON.parse(JSON.stringify(body))));
  });

  it.each([
    ['no name', ''],
    ['a foreign name', 'name=evil'],
    ['an id instead of a name', `name=${'a'.repeat(64)}`],
    ['a name with a slash', `name=%2F${NAME}`],
    ['a name with a dot', `name=${NAME}.x`],
    ['a name that is only the prefix', 'name=agentic-ui-task-'],
    ['two names', `name=${NAME}&name=agentic-ui-task-other`],
    ['platform', `name=${NAME}&platform=linux%2Famd64`],
    ['a semicolon', `name=${NAME};platform=x`],
    ['a bad percent-encoding', `name=${NAME}%ZZ`],
    ['a mirrored key that is not allowed', `name=${NAME}&Privileged=true`],
  ])('refuses a query with %s', (_label, query) => {
    refused(create(containerBody(), query));
  });

  it('decodes the name like the daemon (an encoded valid name is accepted and re-encoded)', () => {
    expect(create(containerBody(), `name=agentic-ui-task-T%2D20261020-327f`)).toMatchObject({ action: 'forward', path: `/containers/create?name=${NAME}` });
  });

  it('refuses bad JSON', () => {
    expect(refused(decide(request('POST', `/containers/create?name=${NAME}`, '{"Image":'), config))).toMatch(/JSON/);
  });

  it('refuses an empty body', () => {
    refused(decide(request('POST', `/containers/create?name=${NAME}`), config));
  });

  it('refuses a body that is not an object', () => {
    refused(decide(request('POST', `/containers/create?name=${NAME}`, '[]'), config));
  });

  it('refuses duplicate JSON keys (no parser differential with the daemon)', () => {
    const text = JSON.stringify(containerBody()).replace('"Image":"agentic-test:local"', '"Image":"agentic-test:local","Image":"alpine"');
    expect(refused(decide(request('POST', `/containers/create?name=${NAME}`, text), config))).toMatch(/duplicate/);
  });

  it('refuses an oversized body', () => {
    const big = containerBody({ Env: ['X=' + 'a'.repeat(MAX_BODY_BYTES)] });
    expect(refused(create(big))).toMatch(/too large/);
  });

  it('never puts Env values into the reason', () => {
    const reason = refused(create(containerBody({ Env: ['AGENTIC_TASK_TOKEN=secret-token-value', 7] })));
    expect(reason).not.toContain('secret-token-value');
  });
});

describe('decide: forbidden app port variants', () => {
  const loop = [{ HostIp: '127.0.0.1', HostPort: '' }];
  it.each([
    ['a binding on all interfaces', withPorts([3000], { '3000/tcp': [{ HostIp: '0.0.0.0', HostPort: '' }] })],
    ['a binding without HostIp (all interfaces)', withPorts([3000], { '3000/tcp': [{ HostPort: '' }] })],
    ['an empty HostIp', withPorts([3000], { '3000/tcp': [{ HostIp: '', HostPort: '' }] })],
    ['an IPv6 HostIp', withPorts([3000], { '3000/tcp': [{ HostIp: '::', HostPort: '' }] })],
    ['another loopback address', withPorts([3000], { '3000/tcp': [{ HostIp: '127.0.0.2', HostPort: '' }] })],
    ['a fixed host port', withPorts([3000], { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3000' }] })],
    ['a host port range', withPorts([3000], { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3000-3010' }] })],
    ['a missing HostPort', withPorts([3000], { '3000/tcp': [{ HostIp: '127.0.0.1' }] })],
    ['a numeric HostPort', withPorts([3000], { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: 0 }] })],
    ['an extra key in a binding', withPorts([3000], { '3000/tcp': [{ ...loop[0], HostName: 'x' }] })],
    ['two bindings for a port', withPorts([3000], { '3000/tcp': [...loop, ...loop] })],
    ['no binding for a port', withPorts([3000], { '3000/tcp': [] })],
    ['a null binding list', withPorts([3000], { '3000/tcp': null })],
    ['a binding that is not an object', withPorts([3000], { '3000/tcp': ['127.0.0.1:'] })],
    ['udp', withPorts([3000], { '3000/udp': loop }, { '3000/udp': {} })],
    ['sctp', withPorts([3000], { '3000/sctp': loop }, { '3000/sctp': {} })],
    ['a port without protocol', withPorts([3000], { '3000': loop }, { '3000': {} })],
    ['port 0', withPorts([0])],
    ['port 65536', withPorts([65536])],
    ['a port with a leading zero', withPorts([3000], { '03000/tcp': loop }, { '03000/tcp': {} })],
    ['a container port range', withPorts([3000], { '3000-3005/tcp': loop }, { '3000-3005/tcp': {} })],
    ['a port with an IP prefix', withPorts([3000], { '0.0.0.0:3000/tcp': loop }, { '0.0.0.0:3000/tcp': {} })],
    ['PortBindings without ExposedPorts', containerBody({}, { PortBindings: { '3000/tcp': loop } })],
    ['ExposedPorts without PortBindings', containerBody({ ExposedPorts: { '3000/tcp': {} } })],
    ['an exposed port that is not bound', withPorts([3000], undefined, { '3000/tcp': {}, '4000/tcp': {} })],
    ['a bound port that is not exposed', withPorts([3000, 4000], undefined, { '3000/tcp': {} })],
    ['an ExposedPorts value that is not {}', withPorts([3000], undefined, { '3000/tcp': { x: 1 } })],
    ['an ExposedPorts value null', withPorts([3000], undefined, { '3000/tcp': null })],
    ['empty PortBindings and ExposedPorts', withPorts([])],
    ['PortBindings that is not an object', withPorts([3000], [loop], undefined)],
    ['ExposedPorts that is a list', withPorts([3000], undefined, ['3000/tcp'])],
    [`more than ${MAX_APP_PORTS} ports`, withPorts(Array.from({ length: MAX_APP_PORTS + 1 }, (_v, i) => 3000 + i))],
    ['PublishAllPorts', containerBody({}, { PublishAllPorts: true })],
    ['PublishAllPorts next to the app ports', { ...withPorts([3000]), HostConfig: { ...(withPorts([3000]).HostConfig as object), PublishAllPorts: true } }],
  ])('refuses %s', (_label, body) => {
    refused(create(JSON.parse(JSON.stringify(body))));
  });

  it('refuses the inspect of another image or another image endpoint', () => {
    for (const [method, url] of [
      ['GET', '/images/alpine/json'],
      ['GET', '/images/agentic-test:local2/json'],
      ['GET', '/images/agentic-test/json'],
      ['GET', '/images/agentic-test%3Alocal/json'],
      ['GET', '/images/agentic-test:local/json?x=1'],
      ['GET', '/images/agentic-test:local/history'],
      ['GET', '/images/agentic-test:local'],
      ['HEAD', '/images/agentic-test:local/json'],
      ['POST', '/images/agentic-test:local/json'],
      ['DELETE', '/images/agentic-test:local'],
      ['POST', '/images/agentic-test:local/tag?repo=x'],
      ['GET', '/images/../images/agentic-test:local/json'],
      ['GET', '/v1.47/images/alpine/json'],
    ]) {
      refused(decide(request(method, url), config));
    }
    refused(decide(request('GET', '/images/agentic-test:local/json', { a: 1 }), config));
  });
});

describe('decide: forbidden volume create variants', () => {
  it.each([
    ['DriverOpts (local bind)', volumeBody({ Driver: 'local', DriverOpts: { type: 'none', o: 'bind', device: '/' } })],
    ['DriverOpts without driver', volumeBody({ DriverOpts: { o: 'bind' } })],
    ['another driver', volumeBody({ Driver: 'nfs' })],
    ['a foreign name', volumeBody({ Name: 'evil' })],
    ['no name', volumeBody({ Name: undefined })],
    ['no labels', volumeBody({ Labels: undefined })],
    ['a foreign label', volumeBody({ Labels: { ...LABELS, other: 'x' } })],
    ['a task label of another task', volumeBody({ Labels: { ...LABELS, 'agentic-ui.task': 'T-x' } })],
    ['an unknown key', volumeBody({ ClusterVolumeSpec: {} })],
    ['a lower-case key', volumeBody({ driverOpts: { o: 'bind' } })],
  ])('refuses %s', (_label, body) => {
    refused(decide(request('POST', '/volumes/create', JSON.parse(JSON.stringify(body))), config));
  });

  it('refuses a query key that dockerode would not mirror', () => {
    refused(decide(request('POST', '/volumes/create?DriverOpts=x', volumeBody()), config));
  });
});

describe('decide: forbidden endpoints and request tricks', () => {
  it.each([
    ['POST', `/containers/${NAME}/exec`],
    ['POST', `/exec/abc/start`],
    ['POST', `/containers/${NAME}/attach`],
    ['GET', `/containers/${NAME}/logs`],
    ['PUT', `/containers/${NAME}/archive?path=%2F`],
    ['POST', `/containers/${NAME}/kill`],
    ['POST', `/containers/${NAME}/restart`],
    ['POST', `/containers/${NAME}/update`],
    ['POST', `/containers/${NAME}/rename?name=x`],
    ['POST', `/containers/${NAME}/pause`],
    ['GET', `/containers/${NAME}/export`],
    ['POST', `/commit?container=${NAME}`],
    ['POST', '/build'],
    ['GET', '/images/json'],
    ['POST', '/images/create?fromImage=alpine'],
    ['GET', '/networks'],
    ['POST', '/networks/create'],
    ['POST', '/networks/agentic-net/connect'],
    ['GET', '/plugins'],
    ['POST', '/swarm/init'],
    ['GET', '/events'],
    ['GET', '/info'],
    ['GET', '/volumes'],
    ['GET', `/volumes/${NAME}`],
    ['POST', '/containers/prune'],
    ['POST', '/session'],
    ['GET', '/v1.47/containers/agentic-ui-task-x/exec'],
    ['OPTIONS', '/_ping'],
    ['POST', '/_ping'],
    ['PUT', '/version'],
    ['DELETE', `/containers/${NAME}/json`],
    ['POST', `/containers/${NAME}/json`],
    ['GET', `/containers/${NAME}`],
    ['HEAD', `/containers/${NAME}/json`],
  ])('refuses %s %s', (method, url) => {
    refused(decide(request(method, url), config));
  });

  it.each([
    ['an id instead of a name (stop)', `/containers/${'a'.repeat(64)}/stop`],
    ['an upper-case id', `/containers/${'A'.repeat(64)}/start`],
    ['a 63-character id', `/containers/${'a'.repeat(63)}/start`],
    ['a short id', '/containers/abc123/start'],
    ['a foreign name', '/containers/other/start'],
    ['an upper-case path', `/CONTAINERS/${NAME}/start`],
    ['an upper-case action', `/containers/${NAME}/START`],
    ['a trailing slash', `/containers/${NAME}/start/`],
    ['a double slash', `/containers//${NAME}/start`],
    ['a leading double slash', `//containers/${NAME}/start`],
    ['dot segments', `/containers/${NAME}/../other/start`],
    ['a dot segment', `/containers/./${NAME}/start`],
    ['an encoded slash', `/containers/${NAME}%2F..%2Fother/start`],
    ['an encoded name char', `/containers/agentic-ui-task-%41/start`],
    ['an encoded action', `/containers/${NAME}/%73tart`],
    ['a fragment', `/containers/${NAME}/start#x`],
    ['a backslash', `/containers/${NAME}\\start`],
    ['a name with a dot', `/containers/${NAME}.evil/start`],
    ['a name that is only the prefix', '/containers/agentic-ui-task-/start'],
    ['an absolute-URI target', `http://docker/containers/${NAME}/start`],
    ['an asterisk target', '*'],
    ['an empty target', ''],
    ['a bad version prefix', `/v2.0/containers/${NAME}/start`],
    ['a version prefix without a minor', `/v1/containers/${NAME}/start`],
    ['a version prefix twice', `/v1.40/v1.40/containers/${NAME}/start`],
    ['a matrix parameter', `/containers/${NAME};x/start`],
    ['a unicode lookalike', `/containers/agentic‐ui-task-x/start`],
  ])('refuses a path with %s', (_label, url) => {
    refused(decide(request('POST', url), config));
  });

  it.each([
    ['start with a query', `/containers/${NAME}/start?detachKeys=ctrl-x`],
    ['start with checkpoint', `/containers/${NAME}/start?checkpoint=c`],
    ['stop with a signal', `/containers/${NAME}/stop?signal=SIGKILL`],
    ['stop with a non-numeric timeout', `/containers/${NAME}/stop?t=10x`],
    ['stop with two timeouts', `/containers/${NAME}/stop?t=1&t=2`],
    ['json with size', `/containers/${NAME}/json?size=1`],
    ['_ping with a query', '/_ping?x=1'],
    ['archive without path', `/containers/${NAME}/archive`],
    ['archive with two paths', `/containers/${NAME}/archive?path=%2Ftask%2Fa&path=%2Ftask%2Fb`],
  ])('refuses a query on an allowed path: %s', (_label, url) => {
    refused(decide(request(url.includes('archive') || url.includes('json') || url.includes('_ping') ? 'GET' : 'POST', url), config));
  });

  it.each([
    ['link removal', `/containers/${NAME}?link=true`],
    ['a non-boolean force', `/containers/${NAME}?force=maybe`],
    ['a volume force', `/volumes/${NAME}?force=true`],
  ])('refuses a delete with %s', (_label, url) => {
    refused(decide(request('DELETE', url), config));
  });

  it.each([
    [{ upgrade: 'tcp', connection: 'Upgrade' }],
    [{ upgrade: 'h2c' }],
    [{ connection: 'keep-alive, Upgrade' }],
  ])('refuses an upgrade request %p', (headers) => {
    expect(refused(decide(request('GET', '/_ping', undefined, headers), config))).toMatch(/upgrade/);
  });

  it('refuses an upgrade on an otherwise allowed container action', () => {
    refused(decide(request('POST', `/containers/${NAME}/start`, undefined, { upgrade: 'tcp', connection: 'Upgrade' }), config));
  });

  it.each([
    ['start (old API versions honour a HostConfig here)', 'POST', `/containers/${NAME}/start`, { HostConfig: { Privileged: true } }],
    ['start with an empty object', 'POST', `/containers/${NAME}/start`, {}],
    ['stop with more than t', 'POST', `/containers/${NAME}/stop?t=10`, { t: 10, signal: 'KILL' }],
    ['stop with a t that differs from the query', 'POST', `/containers/${NAME}/stop?t=10`, { t: 0 }],
    ['inspect', 'GET', `/containers/${NAME}/json`, 'x'],
    ['ping', 'GET', '/_ping', 'x'],
    ['delete', 'DELETE', `/containers/${NAME}`, 'x'],
  ])('refuses a body on %s', (_label, method, url, body) => {
    refused(decide(request(method, url, body), config));
  });

  it('refuses a lower-case method', () => {
    refused(decide(request('get', '/_ping'), config));
  });
});

describe('decide: a container by full id', () => {
  const CID = 'a1'.repeat(32);

  // dockerode's createContainer returns a handle by id, so the launcher's start right after the create
  // goes to /containers/<id>/start.
  it('allows only start, after the label check by the same id', () => {
    expect(decide(request('POST', `/containers/${CID}/start`), config)).toEqual({
      action: 'check-label',
      resource: 'container',
      name: CID,
      inspectPath: `/containers/${CID}/json`,
      forward: { action: 'forward', method: 'POST', path: `/containers/${CID}/start` },
    });
  });

  it.each([
    ['outside the allowed prefixes', '%2Fetc%2Fshadow'],
    ['root', '%2F'],
    ['/task itself', '%2Ftask'],
    ['/work itself', '%2Fwork'],
    ['/work outside the worktrees', '%2Fwork%2Fsecret'],
    ['a prefix lookalike', '%2Ftask-x%2Fa'],
    ['relative', 'task%2Fa'],
    ['dot-dot segment', '%2Ftask%2F..%2Fetc%2Fshadow'],
    ['trailing dot-dot', '%2Fwork%2F.worktrees%2F..'],
    ['dot-dot into the worktrees', '%2Fwork%2F.worktrees%2F..%2F..%2Fetc'],
    ['NUL byte', '%2Ftask%2Fa%00.txt'],
  ])('refuses an archive path %s', (_label, path) => {
    for (const method of ['GET', 'HEAD']) {
      expect(refused(decide(request(method, `/containers/${NAME}/archive?path=${path}`), config))).toMatch(/path/);
    }
  });

  it('allows archive paths under /task/ and the worktrees, also with dots inside names', () => {
    for (const path of ['%2Ftask%2Fledger.jsonl', '%2Fwork%2F.worktrees%2FT-1%2Fa..b%2Fc.txt', '%2Fwork%2F.worktrees%2FT-1%2F.gitignore']) {
      expect(decide(request('GET', `/containers/${NAME}/archive?path=${path}`), config).action).toBe('check-label');
    }
  });

  it.each([
    ['POST', `/containers/${CID}/stop`],
    ['DELETE', `/containers/${CID}`],
    ['GET', `/containers/${CID}/json`],
    ['GET', `/containers/${CID}/archive?path=%2F`],
  ])('refuses %s %s', (method, url) => {
    expect(refused(decide(request(method, url), config))).toMatch(/name/);
  });
});

describe('inspectShowsKind', () => {
  it('matches a full id against Id, not Name', () => {
    const cid = 'b2'.repeat(32);
    expect(inspectShowsKind('container', cid, { Id: cid, Name: `/${NAME}`, Config: { Labels: LABELS } }, config)).toBe(true);
    expect(inspectShowsKind('container', cid, { Id: 'c3'.repeat(32), Name: `/${cid}`, Config: { Labels: LABELS } }, config)).toBe(false);
    expect(inspectShowsKind('container', cid, { Id: cid, Name: `/${NAME}`, Config: { Labels: {} } }, config)).toBe(false);
  });

  it('accepts a container with the kind label and the same name', () => {
    expect(inspectShowsKind('container', NAME, { Name: `/${NAME}`, Config: { Labels: LABELS } }, config)).toBe(true);
  });

  it('accepts a volume with the kind label and the same name', () => {
    expect(inspectShowsKind('volume', NAME, { Name: NAME, Labels: LABELS }, config)).toBe(true);
  });

  it.each([
    ['no labels', { Name: `/${NAME}`, Config: {} }],
    ['null labels', { Name: `/${NAME}`, Config: { Labels: null } }],
    ['no config', { Name: `/${NAME}` }],
    ['another kind', { Name: `/${NAME}`, Config: { Labels: { 'agentic-ui.kind': 'other' } } }],
    ['another name', { Name: '/agentic-ui-task-other', Config: { Labels: LABELS } }],
    ['labels at the wrong place', { Name: `/${NAME}`, Labels: LABELS }],
    ['not an object', 'x'],
  ])('refuses a container with %s', (_label, body) => {
    expect(inspectShowsKind('container', NAME, body, config)).toBe(false);
  });

  it.each([
    ['no labels', { Name: NAME }],
    ['another kind', { Name: NAME, Labels: { 'agentic-ui.kind': 'x' } }],
    ['another name', { Name: 'x', Labels: LABELS }],
  ])('refuses a volume with %s', (_label, body) => {
    expect(inspectShowsKind('volume', NAME, body, config)).toBe(false);
  });
});
