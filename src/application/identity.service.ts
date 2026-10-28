import type { Identity, IdentityRepository } from '../domain/user/identity.js';
import { EventPublisher, SecurityEventType } from './security-events.js';
import type { DefaultAuthenticationServiceOptions } from './authentication.service.js';
import { AuthenticationError } from './authentication.errors.js';
import type { VerifiedProviderIdentity } from '../domain/provider.js';

export interface IdentityServiceOptions {
  repository: IdentityRepository;
  events: EventPublisher;
  tools: DefaultAuthenticationServiceOptions['tools'];
}

/**
 * Gère les identités (lien entre un User Authen et un compte chez un provider).
 * Il ne crée pas de tokens et ne décide pas des politiques de sécurité.
 */
export class IdentityService {
  private readonly options: IdentityServiceOptions;

  constructor(options: IdentityServiceOptions) {
    this.options = options;
  }

  /** Recherche par (instance, subject) : jamais par email seul. */
  findByProviderSubject(
    instanceId: string,
    subject: string,
  ): Promise<Identity | null> {
    return this.options.repository.findByProviderSubject(instanceId, subject);
  }

  listByUser(userId: string): Promise<Identity[]> {
    return this.options.repository.listByUserId(userId);
  }

  /** Rattache une identité vérifiée par un provider à un utilisateur. */
  async link(
    userId: string,
    verified: VerifiedProviderIdentity,
  ): Promise<Identity> {
    const now = new Date();

    const identity: Identity = {
      id: this.options.tools.generateId(),
      userId,
      providerInstanceId: verified.providerInstanceId,
      providerSubject: verified.subject,
      status: 'active',
      verifiedAt: verified.authenticatedAt,
      lastUsedAt: now,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };

    // Lève "identity_conflict" si (instance, subject) existe déjà.
    await this.options.repository.create(identity);

    await this.publish(SecurityEventType.IdentityLinked, userId, {
      identityId: identity.id,
      providerInstanceId: identity.providerInstanceId,
    });

    return identity;
  }

  /**
   * Détache une identité. On refuse de supprimer la dernière identité active :
   * l'utilisateur ne pourrait plus se connecter.
   */
  async unlink(identityId: string): Promise<Identity> {
    const identity = await this.options.repository.findById(identityId);
    if (!identity) {
      throw new AuthenticationError(
        'identity_not_found',
        `Identity ${identityId}`,
      );
    }
    if (identity.status === 'unlinked') return identity;

    if (identity.status === 'active') {
      const all = await this.options.repository.listByUserId(identity.userId);
      const activeCount = all.filter((i) => i.status === 'active').length;
      if (activeCount <= 1) {
        throw new AuthenticationError(
          'last_identity',
          'Impossible de détacher la dernière identité active',
        );
      }
    }

    const updated: Identity = {
      ...identity,
      status: 'unlinked',
      updatedAt: new Date(),
    };
    await this.options.repository.update(updated);

    await this.publish(SecurityEventType.IdentityUnlinked, identity.userId, {
      identityId: identity.id,
    });

    return updated;
  }

  /** Met à jour la date de dernier usage après une connexion réussie. */
  async markUsed(identity: Identity): Promise<Identity> {
    const now = new Date();
    const updated: Identity = { ...identity, lastUsedAt: now, updatedAt: now };
    await this.options.repository.update(updated);
    return updated;
  }

  private publish(
    eventType: SecurityEventType,
    userId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.options.events.publish({
      id: this.options.tools.generateId(),
      userId,
      eventType,
      occurredAt: new Date(),
      metadata,
    });
  }
}
