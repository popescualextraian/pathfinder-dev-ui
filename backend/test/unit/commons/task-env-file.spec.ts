import { mergeTaskEnv, parseTaskEnv, readTaskEnvFile } from '../../../src/commons/task-env-file';

describe('parseTaskEnv', () => {
  it('reads NAME=value lines: comments, export, quotes, CRLF; the last assignment wins', () => {
    const text = '# c\r\nA=1\r\n\nexport B="two words"\nC=\'x\'\nA=3\nD=a=b\n';
    expect(parseTaskEnv(text)).toEqual({ A: '3', B: 'two words', C: 'x', D: 'a=b' });
  });
  it('names the line, not its content, for a line that is not NAME=value', () => {
    expect(() => parseTaskEnv('A=1\nsecret-without-equals')).toThrow('line 2 is not NAME=value');
    expect(() => parseTaskEnv('A=1\nsecret-without-equals')).not.toThrow(/secret/);
  });
  it('readTaskEnvFile names the file when it cannot be read', () => {
    expect(() => readTaskEnvFile('/nonexistent/task.env')).toThrow('TASK_ENV_FILE (/nonexistent/task.env) cannot be used');
  });
});

describe('mergeTaskEnv', () => {
  const engine = { AGENTIC_TASK_ID: 'T-1', GH_TOKEN: 'ui', GIT_CONFIG_COUNT: '4', GIT_CONFIG_KEY_0: 'k0', GIT_CONFIG_VALUE_0: 'v0' };
  it('the file wins, except the engine\'s AGENTIC_* variables', () => {
    expect(mergeTaskEnv(engine, { GH_TOKEN: 'file', JIRA_TOKEN: 'j', AGENTIC_TASK_ID: 'other' })).toEqual({ ...engine, GH_TOKEN: 'file', JIRA_TOKEN: 'j' });
  });
  it('keeps the engine\'s git config without GIT_CONFIG_COUNT in the file', () => {
    expect(mergeTaskEnv(engine, { A: '1' }).GIT_CONFIG_KEY_0).toBe('k0');
  });
  it('replaces the engine\'s whole git config set when the file has GIT_CONFIG_COUNT', () => {
    const merged = mergeTaskEnv(engine, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'fk', GIT_CONFIG_VALUE_0: 'fv' });
    expect(merged).toMatchObject({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'fk', GIT_CONFIG_VALUE_0: 'fv' });
  });
});
