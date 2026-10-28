import type { Timestamps } from '../shared/types.js';
import { AuthenticationContext } from './authentication.js';

export type SessionStatus = 'active' | 'revoked' | 'expired';

export interface DeviceInfo {
  deviceId: string | null;
  name: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface Session extends Timestamps {
  id: string;
  userId: string;

  status: SessionStatus;
  context: AuthenticationContext;
  device: DeviceInfo;

  authenticatedAt: Date;
  lastActivityAt: Date;

  expiresAt: Date;
  absoluteExpiresAt: Date;

  revokedAt: Date | null;
  revocationReason: string | null;
}

export interface SessionRepository {
  findById(id: string): Promise<Session | null>;
  listByUserId(
    userId: string,
    filter?: { status?: SessionStatus },
  ): Promise<Session[]>;
  create(session: Session): Promise<void>;
  /** Verrou optimiste : `false` si la session n'existe pas ou a changé entre-temps. */
  update(session: Session): Promise<boolean>;
}
