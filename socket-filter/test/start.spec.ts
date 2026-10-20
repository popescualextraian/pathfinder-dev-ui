import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFromEnv } from '../src/start';
import { call } from './helpers/client';
import { FakeUpstream } from './helpers/fake-upstream';

describe('startFromEnv', () => {
  it('refuses to start on bad configuration, naming the variable', async () => {
    await expect(startFromEnv({ FILTER_NETWORK: 'n', FILTER_LISTEN: '/tmp/x.sock' }, () => undefined)).rejects.toThrow(/FILTER_IMAGE/);
  });

  it('starts the filter from the environment', async () => {
    const upstream = await new FakeUpstream().start();
    const dir = mkdtempSync(join(tmpdir(), 'filter-start-'));
    const listen = join(dir, 'docker.sock');
    const lines: string[] = [];
    const server = await startFromEnv(
      { FILTER_IMAGE: 'img:1', FILTER_NETWORK: 'net', FILTER_LISTEN: listen, FILTER_UPSTREAM: upstream.socketPath },
      (line) => lines.push(line),
    );
    try {
      expect((await call(listen, 'GET', '/_ping')).status).toBe(200);
      expect((await call(listen, 'GET', '/info')).status).toBe(403);
      expect(lines).toEqual(['docker-filter: listening', 'docker-filter: refused GET /info: endpoint not allowed']);
    } finally {
      await server.close();
      await upstream.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
