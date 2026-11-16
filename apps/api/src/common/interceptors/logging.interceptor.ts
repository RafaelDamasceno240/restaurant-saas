import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Logger } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { redactUrlQuery } from '../util/redact-url.util';

// Lightweight duration log per request, complementing pino-http's access
// log with an explicit "handler finished" line (useful once business logic
// gets heavier in later phases).
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RequestDuration');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const started = Date.now();
    return next.handle().pipe(
      tap(() => {
        this.logger.debug(
          `${request.method} ${redactUrlQuery(request.url)} - ${Date.now() - started}ms [requestId=${request.requestId}]`,
        );
      }),
    );
  }
}
