import { Logger } from '@nestjs/common';
import Docker from 'dockerode';
import { Readable } from 'node:stream';
import { EngineConfig } from '../../../commons/engine-config';
import { assertWorktreePaths } from '../../service/worktree-paths';
import { gitCredentialEnv } from './git-credential-env';
import { LEDGER_MAX_BYTES, LaunchResult, LaunchSpec, TASK_GRANTS, TaskInspection, TaskLauncher } from '../../service/task-launcher';

const BRIDGE_PORT = 8765;
const STOP_TIMEOUT_SECONDS = 10;
const KIND_LABEL = 'agentic-ui.kind=task';

type LauncherConfig = Pick<
  EngineConfig,
  'image' | 'dockerNetwork' | 'project' | 'claudeCodeOauthToken' | 'ghToken' | 'gitName' | 'gitEmail' | 'taskExtraEnv' | 'taskExtraBinds'
>;

function hasStatus(error: unknown, ...codes: number[]): boolean {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status !== undefined && codes.includes(status);
}

// The content of the first regular file in a tar stream, or 'too-large' (without reading it) over the cap.
// Skips PAX (x, g) and GNU (L, K) extension entries. Size is octal at offset 124, typeflag at 156.
async function firstTarFile(stream: Readable, maxBytes: number): Promise<Buffer | 'too-large'> {
  let buf = Buffer.alloc(0);
  let pos = 0;
  for await (const chunk of stream) {
    buf = Buffer.concat([buf, chunk as Buffer]);
    for (;;) {
      if (buf.length < pos + 512) break;
      const size = parseInt(buf.toString('ascii', pos + 124, pos + 136).replace(/\0.*$/s, '').trim() || '0', 8);
      if (!(size <= maxBytes)) { stream.destroy(); return 'too-large'; }
      const flag = String.fromCharCode(buf[pos + 156] || 48);
      if (buf.length < pos + 512 + size) break;
      if (flag === '0') return buf.subarray(pos + 512, pos + 512 + size);
      pos += 512 + Math.ceil(size / 512) * 512;
    }
  }
  throw new Error('Truncated archive');
}

// Runs each task in its own container next to the UI, on the shared Docker network.
export class DockerTaskLauncher implements TaskLauncher {
  private readonly logger = new Logger('DockerTaskLauncher');

  constructor(
    private readonly config: LauncherConfig,
    private readonly docker: Docker = new Docker(),
  ) {}

  async launch(spec: LaunchSpec): Promise<LaunchResult> {
    const name = this.name(spec.taskId);
    await this.docker.createVolume({ Name: name, Labels: this.labels(spec.taskId) });
    try {
      const container = await this.docker.createContainer({
        Image: this.config.image,
        name,
        Cmd: ['agentic-bridge'],
        Labels: this.labels(spec.taskId),
        Env: this.env(spec, name),
        HostConfig: {
          Binds: [`${name}:/task`, ...this.config.taskExtraBinds],
          NetworkMode: this.config.dockerNetwork,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
        },
      });
      await container.start();
    } catch (error) {
      await this.remove(spec.taskId).catch(() => undefined);
      throw error;
    }
    return { bridgeUrl: this.bridgeUrl(spec.taskId) };
  }

  async start(taskId: string): Promise<void> {
    try {
      await this.docker.getContainer(this.name(taskId)).start();
    } catch (error) {
      if (!hasStatus(error, 304)) throw error;
    }
  }

  async stop(taskId: string): Promise<void> {
    try {
      await this.docker.getContainer(this.name(taskId)).stop({ t: STOP_TIMEOUT_SECONDS });
    } catch (error) {
      if (!hasStatus(error, 304)) throw error;
    }
  }

  async remove(taskId: string): Promise<void> {
    const name = this.name(taskId);
    try {
      await this.docker.getContainer(name).remove({ force: true, v: true });
    } catch (error) {
      if (!hasStatus(error, 404)) throw error;
    }
    try {
      await this.docker.getVolume(name).remove();
    } catch (error) {
      if (!hasStatus(error, 404)) throw error;
    }
  }

  async inspect(taskId: string): Promise<TaskInspection> {
    const bridgeUrl = this.bridgeUrl(taskId);
    try {
      const info = await this.docker.getContainer(this.name(taskId)).inspect();
      return { exists: true, running: info.State?.Running === true, bridgeUrl };
    } catch (error) {
      if (hasStatus(error, 404)) return { exists: false, running: false, bridgeUrl };
      throw error;
    }
  }

  async countRunning(): Promise<number> {
    const running = await this.docker.listContainers({ filters: { label: [KIND_LABEL], status: ['running'] } });
    return running.length;
  }

  // getArchive works on stopped containers; the volume holds /task.
  async readLedger(taskId: string): Promise<string | undefined> {
    let file: Buffer | 'too-large';
    try {
      const stream = (await this.docker.getContainer(this.name(taskId)).getArchive({ path: '/task/ledger.jsonl' })) as unknown as Readable;
      file = await firstTarFile(stream, LEDGER_MAX_BYTES);
    } catch (error) {
      if (hasStatus(error, 404)) return undefined;
      throw error;
    }
    if (file === 'too-large') {
      this.logger.warn(`The cost ledger of task ${taskId} is over ${LEDGER_MAX_BYTES} bytes and is not read`);
      return undefined;
    }
    return file.toString('utf8');
  }

  // The agent's worktree is /work in the container; a 404 from the archive API means the path is absent.
  async hasFiles(taskId: string, paths: string[]): Promise<Record<string, boolean>> {
    assertWorktreePaths(paths);
    const container = this.docker.getContainer(this.name(taskId));
    const result: Record<string, boolean> = {};
    for (const path of paths) {
      try {
        const stream = (await container.getArchive({ path: `/work/${path}` })) as unknown as Readable;
        stream.destroy();
        result[path] = true;
      } catch (error) {
        if (!hasStatus(error, 404)) throw error;
        result[path] = false;
      }
    }
    return result;
  }

  private name(taskId: string): string {
    return `agentic-ui-task-${taskId}`;
  }

  private bridgeUrl(taskId: string): string {
    return `http://${this.name(taskId)}:${BRIDGE_PORT}`;
  }

  // Labels are visible to anyone who can list containers: ids only, no secrets.
  private labels(taskId: string): Record<string, string> {
    return { 'agentic-ui.task': taskId, 'agentic-ui.kind': 'task' };
  }

  private env(spec: LaunchSpec, name: string): string[] {
    const env: Record<string, string> = {
      AGENTIC_TASK_TOKEN: spec.taskToken,
      AGENTIC_AGENT_TOKEN: spec.agentToken,
      AGENTIC_TASK_ID: spec.taskId,
      AGENTIC_PROJECT: this.config.project,
      AGENTIC_TASK_DIR: '/task',
      AGENTIC_COST_LEDGER_DIR: '/task',
      AGENTIC_REPO_URL: spec.repoUrl,
      ...(spec.repoRef ? { AGENTIC_REPO_REF: spec.repoRef } : {}),
      AGENTIC_PROMPT: spec.prompt,
      ...(spec.model ? { AGENTIC_MODEL: spec.model } : {}),
      AGENTIC_ALLOWED_ACTIONS: TASK_GRANTS,
      AGENTIC_WORKTREE: '1',
      AGENTIC_BRANCH: spec.branch,
      AGENTIC_BRIDGE_HOSTS: name,
      CLAUDE_CODE_OAUTH_TOKEN: this.config.claudeCodeOauthToken,
      GH_TOKEN: this.config.ghToken,
      GIT_AUTHOR_NAME: this.config.gitName,
      GIT_AUTHOR_EMAIL: this.config.gitEmail,
      GIT_COMMITTER_NAME: this.config.gitName,
      GIT_COMMITTER_EMAIL: this.config.gitEmail,
      ...gitCredentialEnv(spec.repoUrl),
      ...this.config.taskExtraEnv,
    };
    return Object.entries(env).map(([key, value]) => `${key}=${value}`);
  }
}
