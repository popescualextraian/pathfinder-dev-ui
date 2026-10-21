import { LaunchResult, LaunchSpec, TaskInspection, TaskLauncher, WorktreeFileTooLargeError } from '../../src/engine/service/task-launcher';
import { assertWorktreePaths } from '../../src/engine/service/worktree-paths';

// In-memory TaskLauncher: "containers" are map entries; every task's bridge is at `bridgeUrl`.
export class FakeLauncher implements TaskLauncher {
  containers = new Map<string, { running: boolean }>();
  specs: LaunchSpec[] = [];
  // What readLedger returns (undefined: no ledger).
  ledger: string | undefined;

  constructor(public bridgeUrl = 'http://127.0.0.1:1') {}

  async launch(spec: LaunchSpec): Promise<LaunchResult> {
    this.specs.push(spec);
    this.containers.set(spec.taskId, { running: true });
    return { bridgeUrl: this.bridgeUrl };
  }
  async start(taskId: string): Promise<void> {
    this.containers.get(taskId)!.running = true;
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
  async readLedger(): Promise<string | undefined> {
    return this.ledger;
  }
}
