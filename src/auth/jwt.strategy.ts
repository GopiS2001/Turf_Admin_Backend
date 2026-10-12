import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from '../common/decorators/auth.decorators';
import { AccountStatus, Role } from '../common/enums';
import { UsersService } from '../users/users.service';
import { AuthConfig } from './auth.config';
import type { AccessPayload } from './auth.service';
import { SessionsService } from './sessions.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AuthConfig,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.accessSecret,
      algorithms: ['HS256'],
    });
  }

  /**
   * Re-check the account and the session on every request, so deactivated users and
   * revoked sessions (logout, password change) lose access immediately rather than
   * when the 15-minute access token runs out.
   */
  async validate(payload: AccessPayload): Promise<AuthUser> {
    if (payload.typ !== 'access' || !payload.sid) {
      throw new UnauthorizedException('Your session is no longer valid');
    }
    const [user, sessionActive] = await Promise.all([
      this.users.findOne(payload.sub).catch(() => null),
      this.sessions.isActive(payload.sid, payload.sub),
    ]);
    // Admin-only system: a token for any other role (or a deactivated admin) is rejected.
    if (
      !sessionActive ||
      !user ||
      user.status !== AccountStatus.ACTIVE ||
      user.role !== Role.ADMIN
    ) {
      throw new UnauthorizedException('Your session is no longer valid');
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: payload.sid,
    };
  }
}
