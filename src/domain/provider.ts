import type { Metadata, Timestamps } from '../shared/types.js';
import type { TransactionPurpose } from './transaction.js';

export interface ProviderInstance extends Timestamps {
  id: string;
  type: string;

  enabled: boolean;
  configurationRef: string;

  metadata: Metadata;
}

/** Identité prouvée par le provider (subject + claims déjà vérifiés). */
export interface VerifiedProviderIdentity {
  providerInstanceId: string;
  subject: string;

  claims: {
    email?: string;
    emailVerified?: boolean;
    phoneNumber?: string;
    phoneVerified?: boolean;
    name?: string;
    picture?: string;
  };

  methods: string[];
  authenticatedAt: Date;
}

export type AuthStep =
  | {
      type: 'authenticated';
      identity: VerifiedProviderIdentity;
    }
  | {
      type: 'challenge';
      challengeType: string;
      expiresAt: Date;
      publicData: Metadata;
    }
  | {
      type: 'redirect';
      url: string;
    }
  | {
      type: 'rejected';
      code: string;
      retryable: boolean;
    };

/**
 * Une capacité décrit ce qu'un provider sait faire.
 * Le `(string & {})` permet d'ajouter des capacités custom sans perdre l'autocomplétion.
 */
export type ProviderCapability =
  | 'password'
  | 'challenge'
  | 'redirect'
  | 'passkey'
  | 'enrollment'
  | 'recovery'
  | (string & {});

/** Carte d'identité d'un type de provider (ex. "google", "email-otp"). */
export interface ProviderManifest {
  type: string;
  name: string;
  version: string;

  capabilities: readonly ProviderCapability[];
}

/** Ce que le core transmet au provider à chaque appel. */
export interface ProviderContext {
  transactionId: string;
  providerInstanceId: string;

  clientId: string | null;
  purpose: TransactionPurpose;
}

export interface AuthenticationProvider {
  readonly manifest: ProviderManifest;

  /** Première étape : démarre l'authentification. */
  begin(context: ProviderContext, input: unknown): Promise<AuthStep>;

  /** Étapes suivantes : réponse au challenge, callback OIDC, etc. */
  continue(context: ProviderContext, input: unknown): Promise<AuthStep>;
}

/** Annuaire des providers disponibles (types enregistrés au démarrage). */
export interface ProviderRegistry {
  register(provider: AuthenticationProvider): void;

  unregister(type: string): void;

  /**
   * Retrouve le provider qui gère une instance configurée.
   * Asynchrone car il faut lire l'instance en base pour connaître son type.
   */
  resolve(instanceId: string): Promise<AuthenticationProvider>;

  list(): ProviderManifest[];
}

export interface ProviderInstanceRepository {
  findById(id: string): Promise<ProviderInstance | null>;

  findByType(type: string): Promise<ProviderInstance | null>;

  /** Lève une erreur si l'id existe déjà. */
  create(instance: ProviderInstance): Promise<ProviderInstance>;

  /**
   * Verrou optimiste : n'écrit que si l'`updatedAt` stocké vaut `expectedUpdatedAt`.
   * Retourne `false` si l'instance n'existe pas ou a été modifiée entre-temps.
   */
  update(instance: ProviderInstance, expectedUpdatedAt: Date): Promise<boolean>;

  /** Retourne `false` si l'instance n'existait pas. */
  delete(id: string): Promise<boolean>;

  list(filter?: {
    type?: string;
    enabled?: boolean;
  }): Promise<ProviderInstance[]>;
}

export class ProviderInstanceNotFoundError extends Error {
  constructor(readonly instanceId: string) {
    super(`Provider instance not found: ${instanceId}`);
    this.name = 'ProviderInstanceNotFoundError';
  }
}

export class ProviderInstanceDisabledError extends Error {
  constructor(readonly instanceId: string) {
    super(`Provider instance is disabled: ${instanceId}`);
    this.name = 'ProviderInstanceDisabledError';
  }
}

export class ProviderNotRegisteredError extends Error {
  constructor(readonly type: string) {
    super(`Provider type not registered: ${type}`);
    this.name = 'ProviderNotRegisteredError';
  }
}
