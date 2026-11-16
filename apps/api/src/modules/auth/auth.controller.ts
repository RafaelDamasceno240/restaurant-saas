import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { AppConfig } from '../../config/configuration';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { AuthService, AuthResult, RequestMeta } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const authRateLimit = (): number => Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE) || 10;

const REFRESH_COOKIE_NAME = 'refresh_token';
// Path MUST be '/' — not '/auth'. Two independent reasons:
//   1. Global URI versioning (main.ts) means the real endpoint is
//      /v1/auth/refresh, not /auth/refresh. A cookie scoped to '/auth'
//      would never be attached to a request whose path is '/v1/auth/refresh'
//      (cookie Path matching is a plain string-prefix check against the
//      request path — '/v1/auth/refresh' does not start with '/auth').
//   2. apps/web's middleware.ts checks this cookie's presence on requests to
//      /dashboard. The browser reaches this API through the frontend's own
//      /api rewrite, so the cookie is stored for the frontend host — but a
//      '/auth...' scoped path can never match '/dashboard' either. '/' is
//      the only value that is a prefix of both.
// See docs/authentication.md ("Escopo do cookie de refresh") for the full
// reasoning and the production caveat this implies.
const REFRESH_COOKIE_PATH = '/';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // No sign-up here, on purpose: the service is sold, not self-service, so nobody creates a
  // restaurant anonymously (POST /auth/register was removed on 2026-10-28 and answers 404 like
  // any unknown route). Restaurants come from TenantProvisioningService, which has no route.
  @Public()
  @Throttle({ default: { limit: authRateLimit, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autentica um usuário existente' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, this.meta(req));
    this.setRefreshCookie(res, result);
    return this.toResponseBody(result);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotaciona o refresh token (lido do cookie httpOnly)' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedException({ code: 'MISSING_REFRESH_TOKEN', message: 'Sessão não encontrada.' });
    }
    const result = await this.authService.refresh(token, this.meta(req));
    this.setRefreshCookie(res, result);
    return this.toResponseBody(result);
  }

  // @Public() because the access token may already have expired when the user
  // signs out — and a session nobody can end is worse than one that ends
  // without it. This does not loosen anything: the route takes no body and no
  // parameter, and the only session it can end is the one whose refresh token
  // arrives in the httpOnly cookie (see AuthService.logout).
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o refresh token atual e limpa o cookie de sessão' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    await this.authService.logout(token, this.meta(req));
    res.clearCookie(REFRESH_COOKIE_NAME, this.refreshCookieOptions());
  }

  // Authenticated (no @Public): the access token says whose password it is. The session ends
  // with the change, so the cookie goes too and the client signs in again.
  @Throttle({ default: { limit: authRateLimit, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Troca a própria senha (exige a atual) e encerra todas as sessões da conta' })
  async changePassword(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.changePassword(user.userId, dto, this.meta(req));
    res.clearCookie(REFRESH_COOKIE_NAME, this.refreshCookieOptions());
  }

  @Get('me')
  @ApiOperation({ summary: 'Retorna o usuário autenticado' })
  async me(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.authService.me(user.userId);
  }

  private meta(req: Request): RequestMeta {
    return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
  }

  // Shared by set and clear: a browser only drops a cookie when the clearing
  // Set-Cookie matches the attributes it was stored with.
  private refreshCookieOptions(): CookieOptions {
    const isProd = this.config.get('env', { infer: true }) === 'production';
    return { httpOnly: true, secure: isProd, sameSite: 'lax', path: REFRESH_COOKIE_PATH };
  }

  private setRefreshCookie(res: Response, result: AuthResult): void {
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
      ...this.refreshCookieOptions(),
      expires: result.refreshExpiresAt,
    });
  }

  private toResponseBody(result: AuthResult) {
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }
}
