import { loadConfig } from '../src/config';

const base = {
  FILTER_IMAGE: 'agentic-test:local',
  FILTER_NETWORK: 'agentic-net',
  FILTER_LISTEN: '/run/docker-filter/docker.sock',
};

describe('loadConfig', () => {
  it('reads the variables and applies the defaults', () => {
    expect(loadConfig(base)).toEqual({
      image: 'agentic-test:local',
      network: 'agentic-net',
      listen: '/run/docker-filter/docker.sock',
      upstream: '/var/run/docker.sock',
      namePrefix: 'agentic-ui-task-',
      labelPrefix: 'agentic-ui.',
      kindLabel: { key: 'agentic-ui.kind', value: 'task' },
      debug: false,
    });
  });

  it('takes the optional variables', () => {
    const config = loadConfig({
      ...base,
      FILTER_UPSTREAM: '/tmp/up.sock',
      FILTER_NAME_PREFIX: 'x-task-',
      FILTER_LABEL_PREFIX: 'x.',
      FILTER_KIND_LABEL: 'x.kind=job',
      FILTER_DEBUG: '1',
    });
    expect(config).toMatchObject({
      upstream: '/tmp/up.sock',
      namePrefix: 'x-task-',
      labelPrefix: 'x.',
      kindLabel: { key: 'x.kind', value: 'job' },
      debug: true,
    });
  });

  it.each([
    [{ FILTER_IMAGE: undefined }, 'FILTER_IMAGE'],
    [{ FILTER_IMAGE: '' }, 'FILTER_IMAGE'],
    [{ FILTER_IMAGE: 'a b' }, 'FILTER_IMAGE'],
    [{ FILTER_NETWORK: undefined }, 'FILTER_NETWORK'],
    [{ FILTER_NETWORK: 'host' }, 'FILTER_NETWORK'],
    [{ FILTER_NETWORK: 'container:abc' }, 'FILTER_NETWORK'],
    [{ FILTER_LISTEN: undefined }, 'FILTER_LISTEN'],
    [{ FILTER_LISTEN: 'relative.sock' }, 'FILTER_LISTEN'],
    [{ FILTER_UPSTREAM: 'relative.sock' }, 'FILTER_UPSTREAM'],
    [{ FILTER_UPSTREAM: '/run/docker-filter/docker.sock' }, 'FILTER_UPSTREAM'],
    [{ FILTER_NAME_PREFIX: '' }, 'FILTER_NAME_PREFIX'],
    [{ FILTER_NAME_PREFIX: 'a/b-' }, 'FILTER_NAME_PREFIX'],
    [{ FILTER_LABEL_PREFIX: '' }, 'FILTER_LABEL_PREFIX'],
    [{ FILTER_LABEL_PREFIX: 'a=b' }, 'FILTER_LABEL_PREFIX'],
    [{ FILTER_KIND_LABEL: 'agentic-ui.kind' }, 'FILTER_KIND_LABEL'],
    [{ FILTER_KIND_LABEL: 'other.kind=task' }, 'FILTER_KIND_LABEL'],
    [{ FILTER_KIND_LABEL: 'agentic-ui.kind=' }, 'FILTER_KIND_LABEL'],
    [{ FILTER_KIND_LABEL: 'agentic-ui.task=x' }, 'FILTER_KIND_LABEL'],
  ])('refuses %p naming %s without printing values', (patch, variable) => {
    const env: Record<string, string | undefined> = { ...base, ...patch };
    let message = '';
    try {
      loadConfig(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(variable);
    for (const value of Object.values(patch)) {
      if (value && value.length > 3) expect(message).not.toContain(value);
    }
  });
});
