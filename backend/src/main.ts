import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { EngineConfigError, loadEngineConfig } from './commons/engine-config';

async function bootstrap() {
  // Refuse to start on a missing or invalid value; the message names variables, never values.
  try {
    loadEngineConfig();
  } catch (error) {
    if (error instanceof EngineConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
