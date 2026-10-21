import { Logger } from '@nestjs/common';
import Docker from 'dockerode';
import { Readable } from 'node:stream';
import { EngineConfig } from '../../../commons/engine-config';
import { TaskFileName, assertTaskFileName, assertWorktreePaths } from '../../service/worktree-paths';
import { gitCredentialEnv } from './git-credential-env';
import {
  AppPorts,
  LEDGER_MAX_BYTES,
  TASK_FILE_MAX_BYTES,
  LaunchResult,
  LaunchSpec,
  TASK_GRANTS,
  TaskInspection,
  TaskLauncher,
  WorktreeFileTooLargeError,
} from '../../service/task-launcher';

const BRIDGE_PORT = 8765;
const STOP_TIMEOUT_SECONDS = 10;
const KIND_LABEL = 'agentic-ui.kind=task';
const APPS_LABEL = 'agentic.apps';

// The image's apps label: base64 of JSON {name: {ports: [int], url, autostart}}. Only names and ports are used here.
// undefined when it is malformed (the caller logs once, without the value).
function parseAppsLabel(label: string): Record<string, number[]> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(label, 'base64').toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const apps: Record<string, number[]> = {};
    for (const [name, app] of Object.entries(value)) {
      const ports = (app as { ports?: unknown } | null)?.ports;
      if (!Array.isArray(ports) || !ports.every((p) => Number.isInteger(p) && (p as number) >= 1 && (p as number) <= 65535)) return undefined;
      apps[name] = ports as number[];
    }
    return apps;
  } catch {
    return undefined;
  }
}

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
      if (flag === '5' || flag === '2' || flag === '1') throw new Error('not a regular file');
      if (flag === '0') return buf.subarray(pos + 512, pos + 512 + size);
      pos += 512 + Math.ceil(size / 512) * 512;
    }
  }
  throw new Error('Truncated archive');
}

// Runs each task in its own container next to the UI, on the shared Docker network.
export class DockerTaskLauncher implements TaskLauncher {
  private readonly logger = new Logger('DockerTaskLauncher');
  private warnedAppsLabel = false;

  constructor(
    private readonly config: LauncherConfig,
    private readonly docker: Docker = new Docker(),
  ) {}

  async launch(spec: LaunchSpec): Promise<LaunchResult> {
    const name = this.name(spec.taskId);
    const apps = await this.apps();
    const containerPorts = [...new Set(Object.values(apps).flat())];
    await this.docker.createVolume({ Name: name, Labels: this.labels(spec.taskId) });
    let appPorts: AppPorts | undefined;
    try {
      const container = await this.docker.createContainer({
        Image: this.config.image,
        name,
        Cmd: ['agentic-bridge'],
        Labels: this.labels(spec.taskId),
        Env: this.env(spec, name),
        ...(containerPorts.length ? { ExposedPorts: Object.fromEntries(containerPorts.map((p) => [`${p}/tcp`, {}])) } : {}),
        HostConfig: {
          Binds: [`${name}:/task`, ...this.config.taskExtraBinds],
          NetworkMode: this.config.dockerNetwork,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          // Docker picks a free host port, so two tasks with the same app never clash; loopback only.
          ...(containerPorts.length
            ? { PortBindings: Object.fromEntries(containerPorts.map((p) => [`${p}/tcp`, [{ HostIp: '127.0.0.1', HostPort: '' }]])) }
            : {}),
        },
      });
      await container.start();
      if (containerPorts.length) appPorts = await this.hostPorts(container, apps);
    } catch (error) {
      await this.remove(spec.taskId).catch(() => undefined);
      throw error;
    }
    return { bridgeUrl: this.bridgeUrl(spec.taskId), ...(appPorts ? { appPorts } : {}) };
  }

  async start(taskId: string): Promise<AppPorts | undefined> {
    const container = this.docker.getContainer(this.name(taskId));
    try {
      await container.start();
    } catch (error) {
      if (!hasStatus(error, 304)) throw error;
    }
    // Docker may assign new dynamic host ports on a restart: read the current ones back.
    const apps = await this.apps();
    return Object.keys(apps).length ? this.hostPorts(container, apps) : undefined;
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

  // The agent works in the task's own worktree, which the bridge (AGENTIC_WORKTREE=1) makes at /work/.worktrees/<task id>
  // (the image's task/worktree.sh); /work is only the clone. A 404 from the archive API means the path is absent.
  async hasFiles(taskId: string, paths: string[]): Promise<Record<string, boolean>> {
    assertWorktreePaths(paths);
    const container = this.docker.getContainer(this.name(taskId));
    const result: Record<string, boolean> = {};
    for (const path of paths) {
      try {
        const stream = (await container.getArchive({ path: `/work/.worktrees/${taskId}/${path}` })) as unknown as Readable;
        stream.destroy();
        result[path] = true;
      } catch (error) {
        if (!hasStatus(error, 404)) throw error;
        result[path] = false;
      }
    }
    return result;
  }

  async readFile(taskId: string, path: string, maxBytes: number): Promise<string | null> {
    assertWorktreePaths([path]);
    let file: Buffer | 'too-large';
    try {
      const stream = (await this.docker.getContainer(this.name(taskId)).getArchive({ path: `/work/.worktrees/${taskId}/${path}` })) as unknown as Readable;
      file = await firstTarFile(stream, maxBytes);
    } catch (error) {
      if (hasStatus(error, 404)) return null;
      throw error;
    }
    if (file === 'too-large') throw new WorktreeFileTooLargeError(path, taskId, maxBytes);
    return file.toString('utf8');
  }

  async readTaskFile(taskId: string, name: TaskFileName): Promise<string | null> {
    assertTaskFileName(name);
    let file: Buffer | 'too-large';
    try {
      const stream = (await this.docker.getContainer(this.name(taskId)).getArchive({ path: `/task/${name}` })) as unknown as Readable;
      file = await firstTarFile(stream, TASK_FILE_MAX_BYTES);
    } catch (error) {
      if (hasStatus(error, 404)) return null;
      throw error;
    }
    if (file === 'too-large') throw new WorktreeFileTooLargeError(name, taskId, TASK_FILE_MAX_BYTES);
    return file.toString('utf8');
  }

  // The image's apps ({name: ports}); none when the label is missing, malformed or the image cannot be read.
  private async apps(): Promise<Record<string, number[]>> {
    let label: string | undefined;
    try {
      const info = await this.docker.getImage(this.config.image).inspect();
      label = info.Config?.Labels?.[APPS_LABEL];
    } catch {
      this.warnAppsOnce('the image could not be inspected');
      return {};
    }
    if (!label) return {};
    const apps = parseAppsLabel(label);
    if (!apps) this.warnAppsOnce('the apps label of the image is malformed');
    return apps ?? {};
  }

  private warnAppsOnce(why: string): void {
    if (this.warnedAppsLabel) return;
    this.warnedAppsLabel = true;
    this.logger.warn(`Tasks start without apps: ${why}`);
  }

  // Host ports Docker assigned, from the started container. A port without a binding is left out; a failed read means no ports.
  private async hostPorts(container: Docker.Container, apps: Record<string, number[]>): Promise<AppPorts> {
    let ports: Record<string, Array<{ HostPort?: string }> | null | undefined> = {};
    try {
      ports = (await container.inspect()).NetworkSettings?.Ports ?? {};
    } catch (error) {
      this.logger.warn(`The app ports of a task could not be read: ${(error as Error).message}`);
    }
    const result: AppPorts = {};
    for (const [app, containerPorts] of Object.entries(apps)) {
      result[app] = {};
      for (const port of containerPorts) {
        const host = Number(ports[`${port}/tcp`]?.[0]?.HostPort);
        if (Number.isInteger(host) && host > 0) result[app][String(port)] = host;
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
      ...(spec.scheduled ? { AGENTIC_SCHEDULED: '1', AGENTIC_RUN_TIMEOUT: String(spec.scheduled.runTimeoutSeconds) } : {}),
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
