import { AppPorts, LaunchResult, LaunchSpec, TaskInspection, TASK_FILE_MAX_BYTES, TaskFileName, TaskLauncher, WorktreeFileTooLargeError } from '../../src/engine/service/task-launcher';
import { assertTaskFileName, assertWorktreePaths } from '../../src/engine/service/worktree-paths';

// In-memory TaskLauncher: "containers" are map entries; every task's bridge is at `bridgeUrl`.
export class FakeLauncher implements TaskLauncher {
  containers = new Map<string, { running: boolean }>();
  specs: LaunchSpec[] = [];
  // What readLedger returns (undefined: no ledger).
  ledger: string | undefined;
  // Host ports the "containers" publish for their apps.
  appPorts: AppPorts | undefined;

  constructor(public bridgeUrl = 'http://127.0.0.1:1') {}

  async launch(spec: LaunchSpec): Promise<LaunchResult> {
    this.specs.push(spec);
    this.containers.set(spec.taskId, { running: true });
    return this.appPorts ? { bridgeUrl: this.bridgeUrl, appPorts: this.appPorts } : { bridgeUrl: this.bridgeUrl };
  }
  async start(taskId: string): Promise<AppPorts | undefined> {
    this.containers.get(taskId)!.running = true;
    return this.appPorts;
  }
  async stop(taskId: string): Promise<void> {
    const c = this.containers.get(taskId);
    if (c) c.running = false;
  }
  async remove(taskId: string): Promise<void> {
    this.containers.delete(taskId);
  }
  async inspect(taskId: string): Promise<TaskInspection> {
    const c = this.containers.get(taskId);
    return { exists: c !== undefined, running: c?.running ?? false, bridgeUrl: this.bridgeUrl };
  }
  async countRunning(): Promise<number> {
    return [...this.containers.values()].filter((c) => c.running).length;
  }
  // Which worktree paths exist, per task (hasFiles answers false for any path not listed).
  files = new Map<string, Set<string>>();
  async hasFiles(taskId: string, paths: string[]): Promise<Record<string, boolean>> {
    assertWorktreePaths(paths);
    return Object.fromEntries(paths.map((p) => [p, this.files.get(taskId)?.has(p) ?? false]));
  }
  // Contents of worktree files, per task (readFile answers null for any path not listed).
  fileContents = new Map<string, Map<string, string>>();
  async readFile(taskId: string, path: string, maxBytes: number): Promise<string | null> {
    assertWorktreePaths([path]);
    const text = this.fileContents.get(taskId)?.get(path);
    if (text === undefined) return null;
    if (Buffer.byteLength(text) > maxBytes) throw new WorktreeFileTooLargeError(path, taskId, maxBytes);
    return text;
  }
  // Contents of /task files (result.md, state.json), per task; tests set them here (readTaskFile answers null for any not listed).
  taskFiles = new Map<string, Map<string, string>>();
  setTaskFile(taskId: string, name: TaskFileName, text: string): void {
    if (!this.taskFiles.has(taskId)) this.taskFiles.set(taskId, new Map());
    this.taskFiles.get(taskId)!.set(name, text);
  }
  async readTaskFile(taskId: string, name: TaskFileName): Promise<string | null> {
    assertTaskFileName(name);
    const text = this.taskFiles.get(taskId)?.get(name);
    if (text === undefined) return null;
    if (Buffer.byteLength(text) > TASK_FILE_MAX_BYTES) throw new WorktreeFileTooLargeError(name, taskId, TASK_FILE_MAX_BYTES);
    return text;
  }
  async readLedger(): Promise<string | undefined> {
    return this.ledger;
  }
}
