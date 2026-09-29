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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AppConfig } from '../../config/configuration';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { AuthService, AuthResult, RequestMeta } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const REFRESH_COOKIE_NAME = 'refresh_token';
// Path MUST be '/' — not '/auth'. Two independent reasons:
//   1. Global URI versioning (main.ts) means the real endpoint is
//      /v1/auth/refresh, not /auth/refresh. A cookie scoped to '/auth'
//      would never be attached to a request whose path is '/v1/auth/refresh'
//      (cookie Path matching is a plain string-prefix check against the
//      request path — '/v1/auth/refresh' does not start with '/auth').
//   2. apps/web's middleware.ts checks this cookie's presence on requests to
//      /dashboard on a *different origin* (the Next.js server, a different
//      port). Any '/auth...' scoped path can never match '/dashboard'
//      either. '/' is the only value that is a prefix of both.
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

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Cria Tenant + Branch + User(OWNER) e autentica' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto, this.meta(req));
    this.setRefreshCookie(res, result);
    return this.toResponseBody(result);
  }

  @Public()
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

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o refresh token atual e limpa o cookie de sessão' })
  async logout(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    await this.authService.logout(user.userId, token, this.meta(req));
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  @Get('me')
  @ApiOperation({ summary: 'Retorna o usuário autenticado' })
  async me(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.authService.me(user.userId);
  }

  private meta(req: Request): RequestMeta {
    return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
  }

  private setRefreshCookie(res: Response, result: AuthResult): void {
    const isProd = this.config.get('env', { infer: true }) === 'production';
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
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
