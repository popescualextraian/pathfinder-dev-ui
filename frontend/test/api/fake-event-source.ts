type Listener = (e: { data?: string }) => void;

export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  readyState = 1;
  onmessage: Listener | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  private listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data?: unknown) {
    // Events with a payload are real MessageEvents (the backlog stream tells them from connection errors).
    const e = data === undefined ? { data: undefined } : new MessageEvent(type, { data: JSON.stringify(data) });
    if (type === 'message') this.onmessage?.(e);
    if (type === 'error') this.onerror?.();
    if (type === 'open') this.onopen?.();
    this.listeners.get(type)?.forEach((fn) => fn(e));
  }
  static install() {
    FakeEventSource.instances = [];
    (global as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  }
  static get last() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
}
