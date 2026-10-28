import { AuthenticationContext } from '../domain/authentication.js';
import type {
  DeviceInfo,
  Session,
  SessionRepository,
} from '../domain/session.js';
import type { Metadata } from '../shared/types.js';
import { AuthenticationError } from './authentication.errors.js';
import type { DefaultAuthenticationServiceOptions } from './authentication.service.js';
import { EventPublisher, SecurityEventType } from './security-events.js';

export interface SessionOptions {
  /** Inactivité maximale avant expiration (fenêtre glissante). */
  idleTimeoutMs: number;
  /** Durée de vie maximale, non renouvelable, quelle que soit l'activité. */
  absoluteTimeoutMs: number;
  /** Intervalle minimal entre deux écritures de `lastActivityAt` (évite une écriture par requête). */
  touchIntervalMs: number;
}

const DEFAULT_OPTIONS: SessionOptions = {
  idleTimeoutMs: 7 * 24 * 60 * 60 * 1000,
  absoluteTimeoutMs: 30 * 24 * 60 * 60 * 1000,
  touchIntervalMs: 60 * 1000,
};

export interface SessionServiceDeps {
  repository: SessionRepository;
  events: EventPublisher;
  options?: Partial<SessionOptions>;
  tools: DefaultAuthenticationServiceOptions['tools'];
}

export interface CreateSessionInput {
  userId: string;
  /** Contexte renvoyé par `AuthenticationService` dans un résultat "authenticated". */
  context: AuthenticationContext;
  device?: Partial<DeviceInfo>;
}

/** Résultat de `validate` : un refus est un cas normal, pas une exception. */
export type SessionValidation =
  | { valid: true; session: Session }
  | { valid: false; reason: 'not_found' | 'revoked' | 'expired' };

/**
 * Gère les sessions SSO (création, validation, révocation).
 * Il ne vérifie aucun mot de passe et n'émet aucun token.
 */
export class SessionService {
  private readonly deps: SessionServiceDeps;
  private readonly options: SessionOptions;

  constructor(deps: SessionServiceDeps) {
    this.deps = deps;
    this.options = { ...DEFAULT_OPTIONS, ...deps.options };
    assertPositiveDuration('session.idleTimeoutMs', this.options.idleTimeoutMs);
    assertPositiveDuration(
      'session.absoluteTimeoutMs',
      this.options.absoluteTimeoutMs,
    );
    if (
      !Number.isFinite(this.options.touchIntervalMs) ||
      this.options.touchIntervalMs < 0
    ) {
      throw new RangeError(
        'session.touchIntervalMs doit être un nombre fini positif ou nul',
      );
    }
  }

  /** Crée une session après une authentification réussie. */
  async create(input: CreateSessionInput): Promise<Session> {
    const now = new Date();
    const nowMs = now.getTime();
    const absoluteExpiresAt = new Date(nowMs + this.options.absoluteTimeoutMs);

    const session: Session = {
      id: this.deps.tools.generateId(),
      userId: input.userId,
      status: 'active',
      context: input.context,
      device: {
        deviceId: input.device?.deviceId ?? null,
        name: input.device?.name ?? null,
        userAgent: input.device?.userAgent ?? null,
        ipAddress: input.device?.ipAddress ?? null,
      },
      authenticatedAt: input.context.authenticatedAt,
      lastActivityAt: now,
      expiresAt: this.slidingExpiry(nowMs, absoluteExpiresAt),
      absoluteExpiresAt,
      revokedAt: null,
      revocationReason: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.deps.repository.create(session);
    await this.publish(SecurityEventType.SessionCreated, session.userId, {
      sessionId: session.id,
    });

    return session;
  }

  /**
   * Vérifie qu'une session est utilisable. Si oui, prolonge son expiration
   * glissante (sans jamais dépasser l'expiration absolue).
   * Garde `status` cohérent : une session échue est marquée "expired".
   */
  async validate(id: string): Promise<SessionValidation> {
    const session = await this.deps.repository.findById(id);
    if (!session) return { valid: false, reason: 'not_found' };
    if (session.status === 'revoked')
      return { valid: false, reason: 'revoked' };
    if (session.status === 'expired')
      return { valid: false, reason: 'expired' };

    const now = new Date();
    const nowMs = now.getTime();

    if (
      nowMs >= session.expiresAt.getTime() ||
      nowMs >= session.absoluteExpiresAt.getTime()
    ) {
      await this.save({ ...session, status: 'expired' });
      return { valid: false, reason: 'expired' };
    }

    // On ne réécrit en base que si la dernière activité est assez ancienne.
    if (
      nowMs - session.lastActivityAt.getTime() >=
      this.options.touchIntervalMs
    ) {
      const touched = await this.save({
        ...session,
        lastActivityAt: now,
        expiresAt: this.slidingExpiry(nowMs, session.absoluteExpiresAt),
      });
      return { valid: true, session: touched };
    }

    return { valid: true, session };
  }

  /** Révoque une session (idempotent). */
  async revoke(id: string, reason = 'logout'): Promise<Session> {
    const session = await this.deps.repository.findById(id);
    if (!session) {
      throw new AuthenticationError('session_not_found', `Session ${id}`);
    }
    if (session.status === 'revoked') return session;

    const now = new Date();
    const revoked = await this.save({
      ...session,
      status: 'revoked',
      revokedAt: now,
      revocationReason: reason,
    });

    await this.publish(SecurityEventType.SessionRevoked, session.userId, {
      sessionId: session.id,
      reason,
    });

    return revoked;
  }

  /**
   * Révoque toutes les sessions actives d'un utilisateur
   * (déconnexion partout, changement de mot de passe, compte suspendu...).
   * Retourne le nombre de sessions révoquées.
   */
  async revokeAll(
    userId: string,
    options: { reason?: string; exceptSessionId?: string } = {},
  ): Promise<number> {
    const sessions = await this.deps.repository.listByUserId(userId);
    const targets = sessions.filter(
      (s) => s.status === 'active' && s.id !== options.exceptSessionId,
    );

    for (const session of targets) {
      await this.revoke(session.id, options.reason ?? 'revoke_all');
    }
    return targets.length;
  }

  /** Sessions encore valides d'un utilisateur (page "mes appareils"). */
  async listActive(userId: string): Promise<Session[]> {
    const now = new Date().getTime();
    const sessions = await this.deps.repository.listByUserId(userId);
    return sessions.filter(
      (s) =>
        s.status === 'active' &&
        now < s.expiresAt.getTime() &&
        now < s.absoluteExpiresAt.getTime(),
    );
  }

  /** Expiration glissante, plafonnée par l'expiration absolue. */
  private slidingExpiry(nowMs: number, absoluteExpiresAt: Date): Date {
    return new Date(
      Math.min(nowMs + this.options.idleTimeoutMs, absoluteExpiresAt.getTime()),
    );
  }

  private async save(session: Session): Promise<Session> {
    const updated: Session = { ...session, updatedAt: new Date() };
    await this.deps.repository.update(updated);
    return updated;
  }

  private publish(
    eventType: SecurityEventType,
    userId: string,
    metadata: Metadata,
  ): Promise<void> {
    return this.deps.events.publish({
      id: this.deps.tools.generateId(),
      userId,
      eventType,
      occurredAt: new Date(),
      metadata,
    });
  }
}

function assertPositiveDuration(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${name} doit être un nombre fini strictement positif`,
    );
  }
}
