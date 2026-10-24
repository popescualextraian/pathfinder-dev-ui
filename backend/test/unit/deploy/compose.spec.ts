import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(__dirname, '..', '..', '..', '..');
const SOCKET = '/var/run/docker.sock';

interface Service {
  volumes?: string[];
  group_add?: unknown[];
  network_mode?: string;
  read_only?: boolean;
  cap_drop?: string[];
  security_opt?: string[];
  environment?: Record<string, string>;
  depends_on?: Record<string, { condition?: string }>;
  healthcheck?: { test?: unknown[] };
}

const compose = parse(readFileSync(join(ROOT, 'compose.yaml'), 'utf8')) as { services: Record<string, Service> };
const ui = compose.services.ui;
const filter = compose.services['docker-filter'];
const mountsRawSocket = (s: Service) => (s.volumes ?? []).some((v) => String(v).split(':')[0] === SOCKET || String(v).includes('docker.sock'));

describe('compose.yaml', () => {
  it('has only the docker-filter service mounting the raw Docker socket', () => {
    const mounting = Object.entries(compose.services).filter(([, s]) => mountsRawSocket(s)).map(([name]) => name);
    expect(mounting).toEqual(['docker-filter']);
  });

  it('mounts the workflow definitions writable (the editor saves into them) and the lanes config read-only', () => {
    const vol = (target: string) => (ui.volumes ?? []).map(String).find((v) => v.includes(`:${target}`));
    expect(vol('/etc/pathfinder/workflows')).toMatch(/^\$\{WORKFLOWS_DIR_HOST:-\.\/workflows\.example\}:\/etc\/pathfinder\/workflows$/);
    expect(vol('/etc/pathfinder/backlog.yaml')).toMatch(/:ro$/);
    expect((ui.volumes ?? []).filter((v) => String(v).includes('/etc/pathfinder'))).toHaveLength(2);
  });

  it('passes the architecture settings, its data in the data volume', () => {
    expect(ui.environment?.ARCHITECTURE_ENABLED).toBe('${ARCHITECTURE_ENABLED:-}');
    expect(ui.environment?.ARCHITECTURE_DATA_DIR).toBe('/data/architecture');
    expect(ui.environment?.ARCHITECTURE_FETCH_SECONDS).toBe('${ARCHITECTURE_FETCH_SECONDS:-}');
    expect(ui.volumes).toContain('engine-data:/data');
  });

  it('installs git and CA certificates in the final image stage as root, before USER node', () => {
    const docker = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
    const final = docker.slice(docker.lastIndexOf('\nFROM '));
    const install = final.indexOf('apt-get install -y --no-install-recommends git ca-certificates');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(final.indexOf('USER node'));
    expect(final).toContain('rm -rf /var/lib/apt/lists/*');
  });

  it('gives the ui no Docker group and the filtered socket instead', () => {
    expect(ui.group_add).toBeUndefined();
    expect(ui.volumes).toContain('docker-filter:/run/docker-filter');
    expect(ui.environment?.DOCKER_HOST).toBe('unix:///run/docker-filter/docker.sock');
  });

  it('fixes the app port to 3000 so the mapping and the healthcheck hold whatever the env file says', () => {
    expect(String(ui.environment?.PORT)).toBe('3000');
  });

  it('runs the filter without network, read-only, without capabilities and privileges', () => {
    expect(filter.network_mode).toBe('none');
    expect(filter.read_only).toBe(true);
    expect(filter.cap_drop).toEqual(['ALL']);
    expect(filter.security_opt).toContain('no-new-privileges:true');
    expect(filter.group_add).toHaveLength(1);
    expect(filter.volumes).toContain('docker-filter:/run/docker-filter');
  });

  it('starts the ui only when the filter is healthy, and both have healthchecks', () => {
    expect(ui.depends_on?.['docker-filter']?.condition).toBe('service_healthy');
    expect(filter.healthcheck?.test).toBeDefined();
    expect(JSON.stringify(ui.healthcheck?.test)).toContain('/api/health');
  });

  it('gives the filter the same image and network as the ui engine', () => {
    expect(filter.environment?.FILTER_IMAGE).toBe(ui.environment?.ENGINE_IMAGE);
    expect(filter.environment?.FILTER_NETWORK).toBe(ui.environment?.ENGINE_DOCKER_NETWORK);
  });

  const hasDocker = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
  (hasDocker ? it : it.skip)('is accepted by `docker compose config` with the example env file', () => {
    const r = spawnSync('docker', ['compose', '--env-file', 'tools/compose-check.env.example', 'config', '-q'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});
