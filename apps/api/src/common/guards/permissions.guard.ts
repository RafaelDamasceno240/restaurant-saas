import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../types/authenticated-request-user';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedRequestUser | undefined;
    if (!user) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });
    }

    const hasAll = required.every((permission) => user.permissions.includes(permission));
    if (!hasAll) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Você não tem permissão para executar esta ação.',
      });
    }
    return true;
  }
}
