import { BridgeClient } from './bridge-client';

// Injection token of the function that builds a BridgeClient for a task; tests replace it.
export const BRIDGE_CLIENT_FACTORY = Symbol('BRIDGE_CLIENT_FACTORY');

export type BridgeClientFactory = (record: { bridgeUrl?: string; taskToken: string }) => BridgeClient;

// The Host header is derived from the URL (the container name), as the bridge expects.
export const createBridgeClient: BridgeClientFactory = (record) => {
  if (!record.bridgeUrl) throw new Error('Task has no bridge URL yet');
  return new BridgeClient({ baseUrl: record.bridgeUrl, taskToken: record.taskToken });
};
