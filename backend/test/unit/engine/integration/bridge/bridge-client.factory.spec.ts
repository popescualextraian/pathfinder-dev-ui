import { HttpBridgeClient } from '../../../../../src/engine/integration/bridge/http-bridge-client';
import { createBridgeClient } from '../../../../../src/engine/integration/bridge/bridge-client.factory';

describe('createBridgeClient', () => {
  it('builds a real BridgeClient from a record', () => {
    const client = createBridgeClient({ bridgeUrl: 'http://agentic-ui-task-t-1:8765', taskToken: 'x'.repeat(32) });
    expect(client).toBeInstanceOf(HttpBridgeClient);
  });

  it('derives the Host header from the URL', () => {
    const client = createBridgeClient({ bridgeUrl: 'http://agentic-ui-task-t-1:8765', taskToken: 'x'.repeat(32) });
    expect((client as unknown as { host: string }).host).toBe('agentic-ui-task-t-1:8765');
  });

  it('refuses a record without bridge URL', () => {
    expect(() => createBridgeClient({ taskToken: 'x'.repeat(32) })).toThrow(/bridge URL/);
  });
});
