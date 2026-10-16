'use strict';
// Runs INSIDE the helper container of the docker suite (`node -e <this file> <request JSON>`), on
// the test network, so a task bridge is reached by its container name as the UI reaches it in
// production. One HTTP request; the outcome is ONE JSON line on stdout:
//   {"status": <http status>, "body": "<response text>"}   the bridge answered
//   {"error": "<code>"}                                      it did not (ECONNREFUSED, ENOTFOUND, ...)
// Node built-ins only: the task image has node and nothing else we can rely on.
const http = require('node:http');

let answered = false;
function reply(result) {
  if (answered) return;
  answered = true;
  process.stdout.write(JSON.stringify(result) + '\n');
}

function run(spec) {
  const url = new URL(spec.path, spec.baseUrl);
  const payload = spec.body === undefined ? undefined : JSON.stringify(spec.body);
  // Host defaults to url.host, i.e. <container-name>:8765, which AGENTIC_BRIDGE_HOSTS allows.
  const headers = { Authorization: 'Bearer ' + spec.token, Accept: 'application/json' };
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  const req = http.request(url, { method: spec.method, headers }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('error', (error) => reply({ error: error.code || 'response error' }));
    res.on('aborted', () => reply({ error: 'ECONNRESET' }));
    res.on('end', () => {
      clearTimeout(timer);
      reply({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
    });
  });
  const timer = setTimeout(() => {
    reply({ error: 'ETIMEDOUT' });
    req.destroy();
  }, spec.timeoutMs || 10000);
  req.on('error', (error) => {
    clearTimeout(timer);
    reply({ error: error.code || 'request error' });
  });
  req.end(payload);
}

try {
  run(JSON.parse(process.argv[process.argv.length - 1]));
} catch (error) {
  reply({ error: 'bad helper input: ' + (error && error.message) });
}
