import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

// NestFactory (not Test.createTestingModule): ServeStaticModule needs the HTTP adapter when its module is created.
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
  return app;
}
