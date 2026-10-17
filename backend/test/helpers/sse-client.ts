import { INestApplication } from '@nestjs/common';
import { request as httpRequest } from 'node:http';

export interface SseEvent { event?: string; data?: any } // eslint-disable-line @typescript-eslint/no-explicit-any

// A minimal SSE client for tests: collects the events (those with data) and waits for one to match.
export function openSse(app: INestApplication, path = '/api/tasks/stream') {
  const events: SseEvent[] = [];
  let raw = '';
  let status = 0;
  let type: string | undefined;
  const { port } = app.getHttpServer().address() as { port: number };
  const req = httpRequest({ host: '127.0.0.1', port, path, headers: { Accept: 'text/event-stream' } }, (res) => {
    status = res.statusCode ?? 0;
    type = res.headers['content-type'];
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      raw += chunk;
      const blocks = raw.split('\n\n');
      raw = blocks.pop() ?? '';
      for (const block of blocks) {
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (data) events.push({ event: /^event: (.*)$/m.exec(block)?.[1], data: JSON.parse(data) });
      }
    });
  });
  req.on('error', () => undefined);
  req.end();
  return {
    events,
    get status() { return status; },
    get type() { return type; },
    close: () => req.destroy(),
    next: async (match: (e: SseEvent) => boolean, ms = 6000): Promise<SseEvent> => {
      const deadline = Date.now() + ms;
      for (;;) {
        const found = events.find(match);
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`no matching event; saw ${JSON.stringify(events)}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  };
}
