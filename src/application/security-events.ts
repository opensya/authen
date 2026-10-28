import { Metadata } from '../shared/types.js';

/** Types d'événements de sécurité émis par le core (utiles pour l'audit). */
export const SecurityEventType = {
  AuthenticationSucceeded: 'authentication.succeeded',
  AuthenticationFailed: 'authentication.failed',
  UserRegistered: 'user.registered',
  IdentityLinked: 'identity.linked',
  IdentityUnlinked: 'identity.unlinked',
  SessionCreated: 'session.created',
  SessionRevoked: 'session.revoked',
  RefreshTokenReuseDetected: 'token.reuse_detected',
} as const;

export type SecurityEventType =
  (typeof SecurityEventType)[keyof typeof SecurityEventType];

export interface SecurityEvent {
  id: string;
  userId: string | null;

  eventType: string;
  occurredAt: Date;

  metadata: Metadata;
}

/**
 * Publie les événements de sécurité (audit, alertes...).
 * Une implémentation ne devrait pas lever d'exception : elle gère
 * elle-même ses échecs pour ne pas bloquer une connexion.
 */
export interface EventPublisher {
  publish(event: SecurityEvent): Promise<void>;
}
