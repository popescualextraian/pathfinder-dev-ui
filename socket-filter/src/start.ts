import { loadConfig } from './config';
import { FilterServer, Log, startFilterServer } from './server';

/** Loads the configuration (refusing a bad one) and starts the filter. */
export async function startFromEnv(env: Record<string, string | undefined>, log: Log): Promise<FilterServer> {
  const config = loadConfig(env);
  const server = await startFilterServer(config, log);
  log('docker-filter: listening');
  return server;
}
