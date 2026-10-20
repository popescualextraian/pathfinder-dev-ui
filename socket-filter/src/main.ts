import { startFromEnv } from './start';

startFromEnv(process.env, (line) => console.log(line)).then(
  (server) => {
    const stop = (): void => {
      server.close().then(() => process.exit(0), () => process.exit(1));
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  },
  (error: Error) => {
    // Config errors name the variable, never its value.
    console.error(error.message.startsWith('docker-filter:') ? error.message : `docker-filter: ${error.message}`);
    process.exit(1);
  },
);
