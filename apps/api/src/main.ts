import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  const config = app.get(ConfigService<AppConfig, true>);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('corsOrigin', { infer: true }),
    credentials: true,
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // Validation is registered as a global APP_PIPE in AppModule (StrictValidationPipe)
  // instead of here, so it can read @AllowExtraFields() metadata via Reflector.

  const env = config.get('env', { infer: true });
  if (env !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Restaurant SaaS API')
        .setDescription('Fase 01 — Fundação, Auth, Multi-tenancy, RBAC')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get('port', { infer: true });
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on port ${port} (env=${env})`);
}

bootstrap();
