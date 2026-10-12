import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum SessionClient {
  /** Browser: refresh token lives in an httpOnly cookie. */
  WEB = 'WEB',
  /** Native app: refresh token lives in the device's secure storage. */
  MOBILE = 'MOBILE',
}

/**
 * One signed-in device. Access tokens carry the session id, so revoking the row
 * logs that device out on its next request. Only a SHA-256 hash of the current
 * refresh token is stored; the token itself is never persisted.
 */
@Entity('auth_sessions')
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash: string;

  /** The token this one replaced, accepted briefly so parallel refreshes don't collide. */
  @Column({
    name: 'previous_token_hash',
    type: 'char',
    length: 64,
    nullable: true,
  })
  previousTokenHash: string | null;

  @Column({ name: 'rotated_at', type: 'datetime', nullable: true })
  rotatedAt: Date | null;

  @Column({ type: 'enum', enum: SessionClient })
  client: SessionClient;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'last_used_at', type: 'datetime' })
  lastUsedAt: Date;

  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt: Date | null;

  @Column({
    name: 'revoked_reason',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  revokedReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
