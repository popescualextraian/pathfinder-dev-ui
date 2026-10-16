import { LaunchResult, LaunchSpec, TaskInspection, TaskLauncher } from '../../src/repository/tasks/launcher/task-launcher';

// In-memory TaskLauncher: "containers" are map entries; every task's bridge is at `bridgeUrl`.
export class FakeLauncher implements TaskLauncher {
  containers = new Map<string, { running: boolean }>();
  specs: LaunchSpec[] = [];

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
}
