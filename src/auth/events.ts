/** Emitted by UsersService when an account's password, role or status changes; handled by SessionsService. */
export const USER_SESSIONS_REVOKE = 'user.sessions.revoke';

export interface UserSessionsRevokeEvent {
  userId: number;
  reason: string;
  /** Keep this session signed in — the admin who made the change. */
  exceptSessionId?: string;
}
