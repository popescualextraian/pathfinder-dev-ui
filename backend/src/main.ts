import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { BacklogConfigError, loadBacklogConfig } from './backlog';
import { ArchitectureConfigError, architectureEnabled, loadArchitectureConfig } from './commons/architecture-config';
import { EngineConfigError, loadEngineConfig } from './commons/engine-config';

async function bootstrap() {
  // Refuse to start on a missing or invalid value; the message names variables or keys, never values.
  try {
    loadEngineConfig();
    loadBacklogConfig(); // does nothing when BACKLOG_CONFIG is unset
    if (architectureEnabled()) loadArchitectureConfig();
  } catch (error) {
    if (error instanceof EngineConfigError || error instanceof BacklogConfigError || error instanceof ArchitectureConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // SIGINT/SIGTERM close the app, which also stops the processes of the local launcher.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
