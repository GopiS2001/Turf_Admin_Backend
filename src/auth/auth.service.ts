import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { AccountStatus, Role } from '../common/enums';
import { User } from '../users/user.entity';
import { BCRYPT_ROUNDS, UsersService } from '../users/users.service';
import { AuthConfig } from './auth.config';
import { AuthSession, SessionClient } from './auth-session.entity';
import { ChangePasswordDto, LoginDto, UpdateProfileDto } from './dto/auth.dto';
import { ClientMeta, SessionsService } from './sessions.service';

// Compared against when the email doesn't exist, so response time doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('timing-safe-placeholder', BCRYPT_ROUNDS);

export interface AccessPayload {
  sub: number;
  email: string;
  role: Role;
  /** Session id — the token stops working as soon as that session is revoked. */
  sid: string;
  typ: 'access';
}

interface RefreshPayload {
  sub: number;
  sid: string;
  typ: 'refresh';
  jti: string;
}

/** What login and refresh hand back. `refreshToken` goes in a cookie (web) or the body (mobile). */
export interface IssuedTokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: User;
}

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const sameHash = (a: string | null, b: string) =>
  !!a &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

const sessionExpired = () =>
  new UnauthorizedException('Your session has expired. Please sign in again.');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly jwt: JwtService,
    private readonly config: AuthConfig,
  ) {}

  async login(
    dto: LoginDto,
    client: SessionClient,
    meta: ClientMeta,
  ): Promise<IssuedTokens> {
    const user = await this.users.findByEmailWithPassword(dto.email);
    const ok = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_HASH,
    );
    // Only admins sign in. Customers get the same message as a wrong password.
    if (!user || !ok || user.role !== Role.ADMIN)
      throw new UnauthorizedException('Invalid email or password');
    if (user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    const profile = await this.users.findOne(user.id);
    const sessionId = randomUUID();
    const refresh = await this.signRefresh(profile.id, sessionId);
    const now = new Date();
    await this.sessions.create({
      id: sessionId,
      userId: profile.id,
      tokenHash: sha256(refresh.token),
      client,
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt: refresh.expiresAt,
      lastUsedAt: now,
    });
    return this.issue(profile, sessionId, refresh);
  }

  /**
   * Trades a refresh token for a new access token and a new refresh token (rotation).
   * Presenting a refresh token that was already replaced means it leaked or was
   * replayed, so the whole session is revoked.
   */
  async refresh(token: string, meta: ClientMeta): Promise<IssuedTokens> {
    const payload = await this.verifyRefresh(token);
    const hash = sha256(token);

    // Two attempts: the first can lose a race with a parallel refresh of the same session.
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await this.sessions.findActive(payload.sid);
      if (!session || session.userId !== payload.sub) throw sessionExpired();

      if (!this.matches(session, hash)) {
        await this.sessions.revoke(session.id, 'TOKEN_REUSE');
        this.logger.warn(
          `Refresh token reuse on session ${session.id} (user #${session.userId}, ip ${meta.ip}) — session revoked`,
        );
        throw sessionExpired();
      }

      const user = await this.users.findOne(session.userId).catch(() => null);
      if (
        !user ||
        user.status !== AccountStatus.ACTIVE ||
        user.role !== Role.ADMIN
      ) {
        await this.sessions.revoke(session.id, 'ACCOUNT_DISABLED');
        throw sessionExpired();
      }

      const next = await this.signRefresh(user.id, session.id);
      const rotated = await this.sessions.rotate(
        session.id,
        session.tokenHash,
        sha256(next.token),
        next.expiresAt,
        meta,
      );
      if (rotated) return this.issue(user, session.id, next);
    }
    throw sessionExpired();
  }

  /** Revokes the session behind a refresh token. Never fails — logging out always succeeds. */
  async logout(token: string | undefined) {
    if (!token) return;
    try {
      // An expired token may still sign out its (already dead) session; the signature must be ours.
      const payload = await this.jwt.verifyAsync<RefreshPayload>(token, {
        secret: this.config.refreshSecret,
        ignoreExpiration: true,
      });
      if (payload.typ !== 'refresh') return;
      const session = await this.sessions.findActive(payload.sid);
      if (session && this.matches(session, sha256(token))) {
        await this.sessions.revoke(session.id, 'LOGOUT');
      }
    } catch {
      /* invalid token: nothing to revoke */
    }
  }

  async listSessions(userId: number, currentSessionId: string) {
    const sessions = await this.sessions.listActive(userId);
    return sessions.map((s) => ({
      id: s.id,
      client: s.client,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      current: s.id === currentSessionId,
    }));
  }

  async revokeSession(userId: number, sessionId: string) {
    const revoked = await this.sessions.revoke(sessionId, 'REVOKED', userId);
    return { revoked };
  }

  async revokeOtherSessions(userId: number, currentSessionId: string) {
    const revoked = await this.sessions.revokeAllForUser(
      userId,
      'REVOKED',
      currentSessionId,
    );
    return { revoked };
  }

  me(userId: number) {
    return this.users.findOne(userId);
  }

  updateProfile(userId: number, dto: UpdateProfileDto) {
    return this.users.update(userId, dto, userId);
  }

  /** Changing the password signs out every other device; this one stays signed in. */
  async changePassword(
    userId: number,
    currentSessionId: string,
    dto: ChangePasswordDto,
  ) {
    const user = await this.users.findByIdWithPassword(userId);
    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(dto.currentPassword, user.passwordHash))
    ) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current one',
      );
    }
    await this.users.setPassword(userId, dto.newPassword);
    const otherSessionsRevoked = await this.sessions.revokeAllForUser(
      userId,
      'PASSWORD_CHANGED',
      currentSessionId,
    );
    return { updated: true, otherSessionsRevoked };
  }

  /** The current hash, or the one it just replaced (within the grace window). */
  private matches(session: AuthSession, hash: string) {
    if (sameHash(session.tokenHash, hash)) return true;
    return (
      sameHash(session.previousTokenHash, hash) &&
      !!session.rotatedAt &&
      Date.now() - session.rotatedAt.getTime() < this.config.reuseGraceMs
    );
  }

  private async verifyRefresh(token: string) {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(token, {
        secret: this.config.refreshSecret,
      });
    } catch {
      throw sessionExpired();
    }
    if (payload.typ !== 'refresh' || !payload.sid) throw sessionExpired();
    return payload;
  }

  private async signRefresh(userId: number, sessionId: string) {
    const payload: RefreshPayload = {
      sub: userId,
      sid: sessionId,
      typ: 'refresh',
      // Makes every token unique, even two issued in the same second.
      jti: randomBytes(16).toString('hex'),
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.refreshSecret,
      expiresIn: Math.floor(this.config.refreshTtlMs / 1000),
    });
    return {
      token,
      expiresAt: new Date(Date.now() + this.config.refreshTtlMs),
    };
  }

  private async issue(
    user: User,
    sessionId: string,
    refresh: { token: string; expiresAt: Date },
  ): Promise<IssuedTokens> {
    const payload: AccessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: sessionId,
      typ: 'access',
    };
    const expiresIn = Math.floor(this.config.accessTtlMs / 1000);
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.accessSecret,
      expiresIn,
    });
    return {
      accessToken,
      expiresIn,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
      user,
    };
  }
}
