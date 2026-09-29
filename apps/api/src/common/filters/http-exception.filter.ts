import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

// Single place that turns any thrown error into the API-wide error shape
// documented in docs/architecture.md. Never leaks stack traces to clients.
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, code, message, details } = this.resolve(exception);

    const body: ErrorBody = {
      statusCode,
      code,
      message,
      requestId: request.requestId,
      ...(details ? { details } : {}),
    };

    if (statusCode >= 500) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null) {
        const responseObj = response as Record<string, unknown>;
        return {
          statusCode: status,
          code: (responseObj.code as string) ?? this.codeForStatus(status),
          message: (responseObj.message as string) ?? exception.message,
          details: responseObj.details ?? responseObj.message,
        };
      }
      return {
        statusCode: status,
        code: this.codeForStatus(status),
        message: exception.message,
      };
    }

    // Unknown/unexpected error: never leak internals.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Ocorreu um erro inesperado. Tente novamente mais tarde.',
    };
  }

  private codeForStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      429: 'RATE_LIMITED',
    };
    return map[status] ?? 'INTERNAL_SERVER_ERROR';
  }
}
