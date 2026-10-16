import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { SystemApiModule } from './api/system/system-api.module';
import { FRONTEND_DIR } from './commons/frontend-dir';

@Module({
  imports: [
    // Serves the built assets and index.html at /. Its own index.html fallback (renderPath) is switched off
    // by excluding every path: it cannot send files from a dot directory. SpaFallbackFilter does the fallback.
    ServeStaticModule.forRoot({ rootPath: FRONTEND_DIR, exclude: ['/{*path}'] }),
    SystemApiModule,
  ],
})
export class AppModule {}
