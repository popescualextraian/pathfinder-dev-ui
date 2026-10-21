import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const AGENT = resolve(__dirname, '../../../../tools/fake-agent/fake-agent.mjs');

// Spawns the fake agent in a scratch working folder and talks ACP to it over stdio.
class Agent {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly waiting = new Map<number, (m: any) => void>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  readonly said: string[] = [];
  exitCode: Promise<number | null>;

  constructor(readonly cwd: string, state: string, env: Record<string, string> = {}) {
    this.child = spawn('node', [AGENT], { cwd, env: { ...process.env, FAKE_AGENT_STATE: state, ...env } });
    this.exitCode = new Promise((r) => this.child.on('exit', r));
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      const m = JSON.parse(line);
      if (m.method === 'session/update' && m.params.update.sessionUpdate === 'agent_message_chunk') this.said.push(m.params.update.content.text);
      else if (m.id !== undefined) this.waiting.get(m.id)?.(m);
    });
  }

  call(method: string, params: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async session(): Promise<string> {
    return (await this.call('session/new', {})).result.sessionId;
  }

  async prompt(sid: string, text: string): Promise<string> {
    this.said.length = 0;
    await this.call('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text }] });
    return this.said.join('');
  }

  stop() { this.child.kill(); }
}

describe('fake agent FAKE_WRITE marker', () => {
  let dir: string;
  let agent: Agent;
  let sid: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fake-agent-test-'));
    mkdirSync(join(dir, 'work'));
    agent = new Agent(join(dir, 'work'), join(dir, 'state'));
    sid = await agent.session();
  });
  afterEach(() => { agent.stop(); rmSync(dir, { recursive: true, force: true }); });
  const written = (p: string) => readFileSync(join(dir, 'work', p), 'utf8');

  it('writes the fenced block (without fences) to the path in the working folder, then echoes as before', async () => {
    const text = 'FAKE_WRITE:plans/a.md\n```md\n# Plan\n\nstep one\n```\nthe rest';
    expect(await agent.prompt(sid, text)).toBe(`echo: ${text}`);
    expect(written('plans/a.md')).toBe('# Plan\n\nstep one\n');
  });

  it('accepts a fence without a language tag, an empty block and several markers', async () => {
    await agent.prompt(sid, 'intro\nFAKE_WRITE:a.txt\n```\none\n```\nmiddle\nFAKE_WRITE:b/c.txt\n```json\n{"x":1}\n```\nFAKE_WRITE:empty.txt\n```\n```');
    expect(written('a.txt')).toBe('one\n');
    expect(written('b/c.txt')).toBe('{"x":1}\n');
    expect(written('empty.txt')).toBe('');
  });

  it('does not write when the fence does not follow the marker line immediately', async () => {
    await agent.prompt(sid, 'FAKE_WRITE:a.txt\n\n```\nx\n```');
    expect(existsSync(join(dir, 'work', 'a.txt'))).toBe(false);
  });

  it.each(['/tmp/fake-agent-abs.txt', '../escape.txt', 'a/../../escape.txt', 'a/..\\..\\x.txt', ''])('refuses the path %j and writes nothing', async (p) => {
    const reply = await agent.prompt(sid, `FAKE_WRITE:${p}\n\`\`\`\nbad\n\`\`\``);
    expect(reply).toMatch(/^FAKE_WRITE refused/);
    expect(existsSync(join(dir, 'escape.txt'))).toBe(false);
    expect(existsSync('/tmp/fake-agent-abs.txt')).toBe(false);
  });

  it('refuses an unclosed block', async () => {
    expect(await agent.prompt(sid, 'FAKE_WRITE:a.txt\n```\nnever closed')).toMatch(/^FAKE_WRITE refused.*not closed/);
    expect(existsSync(join(dir, 'work', 'a.txt'))).toBe(false);
  });

  it('keeps the single-line markers as they were', async () => {
    expect(await agent.prompt(sid, 'hello')).toBe('echo: hello');
    expect(await agent.prompt(sid, 'SLEEP:10')).toBe('slept');
    expect(await agent.prompt(sid, 'HISTORY')).toBe('history: 4');
  });

  it('finds SLEEP: as a whole line anywhere in a multi-line prompt, and not inside a FAKE_WRITE block', async () => {
    expect(await agent.prompt(sid, 'Skill intro\nSLEEP:10\nmore')).toBe('slept');
    expect(await agent.prompt(sid, 'FAKE_WRITE:s.txt\n```\nSLEEP:100000\n```\nSLEEP:10')).toBe('slept');
    expect(written('s.txt')).toBe('SLEEP:100000\n');
    const text = 'Please do SLEEP:10 now\nsecond line';
    expect(await agent.prompt(sid, text)).toBe(`echo: ${text}`);
  });

  it('finds CRASH as a whole line in a multi-line prompt, after writing', async () => {
    void agent.prompt(sid, 'FAKE_WRITE:c.txt\n```\nx\n```\nCRASH');
    expect(await agent.exitCode).toBe(3);
    expect(written('c.txt')).toBe('x\n');
  });

  it('finds ASK: as a whole line in a multi-line prompt (asks with the text after the marker)', async () => {
    const asked: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const server = require('node:http').createServer((req: any, res: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      let body = '';
      req.on('data', (c: Buffer) => (body += c));
      req.on('end', () => { asked.push(JSON.parse(body).text); res.setHeader('content-type', 'application/json'); res.end('{"id":"Q7"}'); });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const other = new Agent(join(dir, 'work'), join(dir, 'state2'), { AGENTIC_BRIDGE_URL: `http://127.0.0.1:${server.address().port}`, AGENTIC_AGENT_TOKEN: 't' });
    try {
      const s2 = await other.session();
      expect(await other.prompt(s2, 'Description:\nFAKE_WRITE:q.txt\n```\nhi\n```\nASK:which one?\ntail')).toBe('asked Q7');
      expect(asked).toEqual(['which one?']);
      expect(written('q.txt')).toBe('hi\n');
    } finally {
      other.stop();
      server.close();
    }
  });
});
