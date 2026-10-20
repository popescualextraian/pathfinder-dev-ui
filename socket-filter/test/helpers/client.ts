import { IncomingHttpHeaders, request } from 'node:http';
import { connect } from 'node:net';

export interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export function call(
  socketPath: string,
  method: string,
  path: string,
  options: { headers?: Record<string, string | number>; body?: Buffer | string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path, headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

/** Writes raw bytes to the socket and returns everything read until the server closes or `waitMs` passes. */
export function raw(socketPath: string, bytes: string | Buffer, waitMs = 500): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    const chunks: Buffer[] = [];
    const done = (): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(Buffer.concat(chunks).toString('latin1'));
    };
    const timer = setTimeout(done, waitMs);
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('close', done);
    socket.on('error', done);
    socket.write(bytes);
  });
}
