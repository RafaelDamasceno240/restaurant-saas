import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

// Structured JSON logging. Redacts anything that could leak credentials or
// tokens, and stitches the requestId set by RequestIdMiddleware into every
// log line for a request.
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: config.get('env', { infer: true }) === 'production' ? 'info' : 'debug',
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.passwordHash',
              'req.body.accessToken',
              'req.body.refreshToken',
              'res.headers["set-cookie"]',
            ],
            censor: '[REDACTED]',
          },
          customProps: (req) => ({
            requestId: (req as { requestId?: string }).requestId,
          }),
          transport:
            config.get('env', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
