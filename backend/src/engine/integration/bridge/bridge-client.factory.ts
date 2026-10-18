import { BridgeClientFactory } from '../../service/bridge-client';
import { HttpBridgeClient } from './http-bridge-client';

// The Host header is derived from the URL (the container name), as the bridge expects.
export const createBridgeClient: BridgeClientFactory = (record) => {
  if (!record.bridgeUrl) throw new Error('Task has no bridge URL yet');
  return new HttpBridgeClient({ baseUrl: record.bridgeUrl, taskToken: record.taskToken });
};
