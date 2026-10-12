import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Not, Repository } from 'typeorm';
import { AuthSession } from './auth-session.entity';
import { USER_SESSIONS_REVOKE, type UserSessionsRevokeEvent } from './events';

export interface ClientMeta {
  userAgent: string | null;
  ip: string | null;
}

const DAY = 86_400_000;

/** Storage for signed-in devices. Token signing and checks live in AuthService. */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
  ) {}

  create(session: Partial<AuthSession>) {
    return this.sessions.save(this.sessions.create(session));
  }

  /** Not revoked and not past its refresh-token expiry. */
  findActive(id: string) {
    return this.sessions.findOneBy({
      id,
      revokedAt: IsNull(),
      expiresAt: MoreThan(new Date()),
    });
  }

  /** Cheap check run on every authenticated request. */
  isActive(id: string, userId: number) {
    return this.sessions.existsBy({
      id,
      userId,
      revokedAt: IsNull(),
      expiresAt: MoreThan(new Date()),
    });
  }

  /**
   * Swaps in a new refresh-token hash, but only if the stored hash is still `expectedHash`.
   * Returns false when another request rotated the session first.
   */
  async rotate(
    id: string,
    expectedHash: string,
    nextHash: string,
    expiresAt: Date,
    meta: ClientMeta,
  ) {
    const now = new Date();
    const res = await this.sessions.update(
      { id, tokenHash: expectedHash, revokedAt: IsNull() },
      {
        tokenHash: nextHash,
        previousTokenHash: expectedHash,
        rotatedAt: now,
        lastUsedAt: now,
        expiresAt,
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    );
    return (res.affected ?? 0) > 0;
  }

  listActive(userId: number) {
    return this.sessions.find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { lastUsedAt: 'DESC' },
    });
  }

  async revoke(id: string, reason: string, userId?: number) {
    const res = await this.sessions.update(
      { id, revokedAt: IsNull(), ...(userId !== undefined && { userId }) },
      { revokedAt: new Date(), revokedReason: reason },
    );
    return (res.affected ?? 0) > 0;
  }

  /** Signs the user out everywhere, optionally keeping one session (the caller's). */
  async revokeAllForUser(userId: number, reason: string, exceptId?: string) {
    const res = await this.sessions.update(
      { userId, revokedAt: IsNull(), ...(exceptId && { id: Not(exceptId) }) },
      { revokedAt: new Date(), revokedReason: reason },
    );
    return res.affected ?? 0;
  }

  @OnEvent(USER_SESSIONS_REVOKE)
  async onUserChanged(event: UserSessionsRevokeEvent) {
    const count = await this.revokeAllForUser(
      event.userId,
      event.reason,
      event.exceptSessionId,
    );
    if (count)
      this.logger.log(
        `Revoked ${count} session(s) for user #${event.userId} (${event.reason})`,
      );
  }

  /** Expired sessions are useless; revoked ones are kept a month for auditing. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purge() {
    try {
      const now = Date.now();
      const res = await this.sessions
        .createQueryBuilder()
        .delete()
        .where('expires_at < :expired', { expired: new Date(now - DAY) })
        .orWhere('revoked_at < :revoked', { revoked: new Date(now - 30 * DAY) })
        .execute();
      if (res.affected)
        this.logger.log(`Purged ${res.affected} old session(s)`);
    } catch (err) {
      this.logger.error('Session purge failed', err as Error);
    }
  }
}
