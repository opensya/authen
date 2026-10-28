import { DefaultProviderRegistry } from '../application/provider-registry.js';
import type {
  AuthenticationProvider,
  ProviderInstance,
  ProviderInstanceRepository,
} from './provider.js';
import type { Metadata } from '../shared/types.js';
import type {
  AuthenticationTransaction,
  TransactionPurpose,
  TransactionRepository,
} from './transaction.js';

export interface AuthenticationContext {
  providerInstanceId: string;

  methods: string[];
  assuranceLevel: string;

  authenticatedAt: Date;
  verifiedAt: Date;
}

export type AuthResult =
  | {
      type: 'authenticated';
      transactionId: string;
      userId: string;
      isNewUser: boolean;
      context: AuthenticationContext;
    }
  | {
      type: 'challenge';
      transactionId: string;
      challengeType: string;
      expiresAt: Date;
      publicData: Metadata;
    }
  | {
      type: 'redirect';
      transactionId: string;
      url: string;
    }
  | {
      type: 'rejected';
      transactionId: string;
      code: string;
      retryable: boolean;
    };

/** Demande de démarrage d'une authentification. */
export interface BeginAuthenticationRequest {
  type: string;
  clientId: string | null;
  purpose: TransactionPurpose;
  /** Obligatoire pour "link_identity" et "step_up" (l'utilisateur est déjà connu). */
  userId: string | null;
  /** Données brutes envoyées au provider (validées par le provider lui-même). */
  input: unknown;
}

export interface AuthenticationService {
  transactionRepository: TransactionRepository;
  providerInstanceRepository: ProviderInstanceRepository;

  registry: DefaultProviderRegistry;

  // getProvider(): Promise<ProviderInstance>;
  // /** Charge l'instance, vérifie qu'elle est active, puis retrouve son provider. */
  // loadProvider(instanceId: string): Promise<AuthenticationProvider>;

  // /** Démarre une authentification : crée la transaction puis appelle `provider.begin`. */
  // begin(): Promise<AuthResult>;
  // /** Poursuit une authentification en cours (code OTP, callback OIDC...). */
  // continue(): Promise<AuthResult>;

  // handleStep(): Promise<AuthResult>;

  // finalize(): Promise<AuthResult>;

  // /**
  //  * Enregistre un refus. La transaction échoue définitivement si :
  //  * - le refus arrive dès `begin`,
  //  * - le provider indique que ce n'est pas réessayable,
  //  * - le nombre maximal de tentatives est atteint.
  //  */
  // reject(): Promise<AuthResult>;

  // /** Annule une transaction en cours (sans effet si elle est déjà terminée). */
  // cancel(): Promise<void>;

  // save(): Promise<AuthenticationTransaction>;
}
