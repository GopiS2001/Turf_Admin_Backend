import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, Public } from '../common/decorators/auth.decorators';
import type { AuthUser } from '../common/decorators/auth.decorators';
import { allowedOrigins } from '../config/cors';
import { AuthConfig } from './auth.config';
import { SessionClient } from './auth-session.entity';
import { AuthService, type IssuedTokens } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import type { ClientMeta } from './sessions.service';

/** Native apps send this header and get the refresh token in the body; browsers get an httpOnly cookie. */
const CLIENT_HEADER = 'x-client';
const isMobile = (req: Request) =>
  req.headers[CLIENT_HEADER]?.toString().toLowerCase() === 'mobile';

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const clientMeta = (req: Request): ClientMeta => ({
  userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
  ip: req.ip?.slice(0, 45) ?? null,
});

@ApiTags('Auth')
@ApiHeader({
  name: CLIENT_HEADER,
  required: false,
  description:
    '"mobile" for native apps: the refresh token is sent and returned in the JSON body instead of a cookie.',
})
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AuthConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const mobile = isMobile(req);
    if (!mobile) this.assertAllowedOrigin(req);
    const tokens = await this.auth.login(
      dto,
      mobile ? SessionClient.MOBILE : SessionClient.WEB,
      clientMeta(req),
    );
    return this.respond(res, tokens, mobile);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'New access token from the refresh token (cookie, or body for mobile). The refresh token is rotated.',
  })
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // The token's source decides where the new one goes, so a script on a web page can never
    // read a cookie-held token by pretending to be the mobile app.
    const fromBody = !!dto.refreshToken;
    const token = dto.refreshToken ?? readCookie(req, this.config.cookieName);
    if (!fromBody) this.assertAllowedOrigin(req);
    if (!token) throw new UnauthorizedException('You are not signed in');
    try {
      const tokens = await this.auth.refresh(token, clientMeta(req));
      return this.respond(res, tokens, fromBody);
    } catch (err) {
      if (!fromBody)
        res.clearCookie(
          this.config.cookieName,
          this.config.clearCookieOptions(),
        );
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!dto.refreshToken) this.assertAllowedOrigin(req);
    await this.auth.logout(
      dto.refreshToken ?? readCookie(req, this.config.cookieName),
    );
    res.clearCookie(this.config.cookieName, this.config.clearCookieOptions());
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @ApiBearerAuth()
  @Patch('me')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, dto);
  }

  @ApiBearerAuth()
  @Patch('change-password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.id, user.sessionId, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Devices currently signed in to this account' })
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out every other device' })
  @Post('sessions/revoke-others')
  @HttpCode(200)
  revokeOthers(@CurrentUser() user: AuthUser) {
    return this.auth.revokeOtherSessions(user.id, user.sessionId);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out one device' })
  @Delete('sessions/:id')
  revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.auth.revokeSession(user.id, id);
  }

  private respond(res: Response, tokens: IssuedTokens, inBody: boolean) {
    const { accessToken, expiresIn, user } = tokens;
    if (inBody) {
      return {
        accessToken,
        expiresIn,
        refreshToken: tokens.refreshToken,
        refreshExpiresAt: tokens.refreshExpiresAt,
        user,
      };
    }
    res.cookie(
      this.config.cookieName,
      tokens.refreshToken,
      this.config.cookieOptions(),
    );
    return { accessToken, expiresIn, user };
  }

  /**
   * CSRF guard for cookie-authenticated calls: a browser always sends Origin on cross-site
   * POSTs, so anything not on the CORS allowlist is refused (on top of SameSite).
   */
  private assertAllowedOrigin(req: Request) {
    const origin = req.headers.origin;
    const sameOrigin = origin === `${req.protocol}://${req.get('host')}`; // Swagger UI
    if (origin && !sameOrigin && !allowedOrigins().includes(origin)) {
      throw new ForbiddenException('Origin not allowed');
    }
  }
}
