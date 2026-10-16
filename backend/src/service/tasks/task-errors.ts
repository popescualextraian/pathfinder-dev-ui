// What the api layer needs to know about the bridge: re-exported here so it depends on the
// service layer only.
export { BridgeError, BridgeUnreachableError } from '../../repository/tasks/bridge/bridge-client';
export type { BridgeEvent as TaskEvent, BridgeQuestion as TaskQuestion } from '../../repository/tasks/bridge/bridge-client';
