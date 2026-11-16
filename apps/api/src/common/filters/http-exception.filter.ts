import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { redactUrlQuery } from '../util/redact-url.util';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

// B8 (piloto 2026-10-23): what Nest/Express say by themselves is English and technical ("Cannot
// GET /v1/x", "ThrottlerException: Too Many Requests", "Unexpected token } in JSON", "Forbidden
// resource", "Validation failed (uuid is expected)"). Messages the app writes are Portuguese and
// pass through unchanged; those, and anything that is not one readable string, become the
// sentence for the status. The code is never touched.
const TECHNICAL_MESSAGE =
  /^(Bad Request|Unauthorized|Forbidden( resource)?|Not Found|Conflict|Method Not Allowed|Gone|Payload Too Large|Unsupported Media Type|Too Many Requests|Internal Server Error|Service Unavailable|Http Exception)$|^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) |ThrottlerException|JSON|entity too large|^Validation failed|is expected$/i;

const STATUS_MESSAGE: Record<number, string> = {
  400: 'Os dados enviados não são válidos. Confira e tente novamente.',
  401: 'Sua sessão expirou ou o acesso não foi autorizado. Entre novamente.',
  403: 'Você não tem permissão para fazer isso.',
  404: 'Não encontrado.',
  409: 'Não foi possível concluir: os dados mudaram. Atualize a página e tente novamente.',
  413: 'Os dados enviados são grandes demais.',
  429: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
};

export function friendlyMessage(status: number, message: unknown): string {
  const text = Array.isArray(message) ? message.filter((m) => typeof m === 'string').join(' ') : message;
  if (typeof text === 'string' && text.trim() && !TECHNICAL_MESSAGE.test(text.trim())) return text;
  return STATUS_MESSAGE[status] ?? 'Ocorreu um erro inesperado. Tente novamente mais tarde.';
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
        `Unhandled exception on ${request.method} ${redactUrlQuery(request.url)}`,
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
          message: friendlyMessage(status, responseObj.message ?? exception.message),
          ...(responseObj.details !== undefined ? { details: responseObj.details } : {}),
        };
      }
      return {
        statusCode: status,
        code: this.codeForStatus(status),
        message: friendlyMessage(status, exception.message),
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
