import { architectureEnabled, ArchitectureConfigError, loadArchitectureConfig } from '../../../src/commons/architecture-config';

describe('loadArchitectureConfig', () => {
  it('defaults the data dir beside ENGINE_DATA_DIR and fetch seconds to 60', () => {
    expect(loadArchitectureConfig({ ENGINE_DATA_DIR: '/data/tasks' })).toEqual({ dataDir: '/data/architecture', fetchSeconds: 60 });
  });

  it('accepts an explicit absolute dir and fetch seconds', () => {
    expect(loadArchitectureConfig({ ARCHITECTURE_DATA_DIR: '/a/b', ARCHITECTURE_FETCH_SECONDS: '3600' })).toEqual({ dataDir: '/a/b', fetchSeconds: 3600 });
  });

  it('refuses a relative dir naming the variable only', () => {
    expect(() => loadArchitectureConfig({ ARCHITECTURE_DATA_DIR: 'secret/rel' })).toThrow(/ARCHITECTURE_DATA_DIR/);
    try { loadArchitectureConfig({ ARCHITECTURE_DATA_DIR: 'secret/rel' }); } catch (e) {
      expect((e as Error).message).not.toContain('secret/rel');
      expect(e).toBeInstanceOf(ArchitectureConfigError);
    }
  });

  it('refuses when neither dir is set', () => {
    expect(() => loadArchitectureConfig({})).toThrow(/ARCHITECTURE_DATA_DIR/);
  });

  it.each(['0', 'abc', '3601', '-1'])('refuses fetch seconds %s', (v) => {
    expect(() => loadArchitectureConfig({ ENGINE_DATA_DIR: '/d/t', ARCHITECTURE_FETCH_SECONDS: v })).toThrow(/ARCHITECTURE_FETCH_SECONDS/);
  });

  it('refuses a bad ARCHITECTURE_ENABLED', () => {
    expect(() => loadArchitectureConfig({ ENGINE_DATA_DIR: '/d/t', ARCHITECTURE_ENABLED: 'yes' })).toThrow(/ARCHITECTURE_ENABLED/);
  });
});

describe('architectureEnabled', () => {
  it('is true only for 1', () => {
    expect(architectureEnabled({ ARCHITECTURE_ENABLED: '1' })).toBe(true);
    expect(architectureEnabled({ ARCHITECTURE_ENABLED: ' 1 ' })).toBe(true);
    expect(architectureEnabled({ ARCHITECTURE_ENABLED: '0' })).toBe(false);
    expect(architectureEnabled({ ARCHITECTURE_ENABLED: 'true' })).toBe(false);
    expect(architectureEnabled({})).toBe(false);
  });
});
