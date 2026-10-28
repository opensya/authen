import type {
  AuthResult,
  BeginAuthenticationRequest,
} from '../domain/authentication.js';
import type {
  AuthenticationProvider,
  AuthStep,
  ProviderContext,
  ProviderInstance,
  ProviderInstanceRepository,
  VerifiedProviderIdentity,
} from '../domain/provider.js';
import { Metadata } from '../shared/types.js';
import type {
  AuthenticationTransaction,
  TransactionRepository,
} from '../domain/transaction.js';
import { AuthenticationError } from './authentication.errors.js';
import { DefaultProviderRegistry } from './provider-registry.js';
import { type EventPublisher, SecurityEventType } from './security-events.js';
import type { UserRepository } from '../domain/user/user.js';
import type { UserProfileRepository } from '../domain/user/profile.js';
import type { IdentityRepository } from '../domain/user/identity.js';
import type { CredentialRepository } from '../domain/user/credential.js';
import type { SessionRepository } from '../domain/session.js';
import type {
  RefreshTokenRepository,
  TokenFamilyRepository,
} from '../domain/token.js';
import type { UserContactRepository } from './../domain/user/contact.js';
import type { SecureRandom } from '../ports/secure-random.js';
import type { TokenSigner } from '../ports/token.js';
import { UserService } from './user.service.js';
import { ProfileService } from './profile.service.js';
import { IdentityService } from './identity.service.js';
import { SessionService, SessionServiceDeps } from './session.service.js';
import { TokenService, TokenServiceDeps } from './token.service.js';
import { TransactionRunner } from '../ports/transaction-runner.js';
import { IdentityResolution, IdentityResolver } from './identity-resolver.js';
import {
  SecurityPolicyOptions,
  SecurityPolicyService,
} from './security-policy.service.js';

export interface AuthenticationOptions {
  /** Durée de vie d'une transaction (10 min par défaut). */
  ttlMs?: number;
  /** Nombre maximal de tentatives refusées avant échec définitif. */
  maxAttempts?: number;

  session?: SessionServiceDeps['options'];
  token: TokenServiceDeps['options'];
  securityPolicy?: SecurityPolicyOptions;
}

export interface DefaultAuthenticationServiceOptions {
  transactionRepository: TransactionRepository;
  providerInstanceRepository: ProviderInstanceRepository;

  userRepository: UserRepository;
  userProfileRepository: UserProfileRepository;
  userContactRepository: UserContactRepository;
  identityRepository: IdentityRepository;
  credentialRepository: CredentialRepository;
  sessionRepository: SessionRepository;
  tokenFamilyRepository: TokenFamilyRepository;
  refreshTokenRepository: RefreshTokenRepository;

  providers: AuthenticationProvider[];
  unitOfWork: TransactionRunner;

  tools: {
    generateId(): string;
    events: EventPublisher;
    random: SecureRandom;
    token: TokenSigner;
  };

  options?: AuthenticationOptions;
}

/** Résultat de la règle métier appliquée à l'identité vérifiée. */
type ApplyOutcome =
  | { kind: 'authenticated'; userId: string; isNewUser: boolean }
  | { kind: 'rejected'; code: string };

type Phase = 'begin' | 'continue';

const DEFAULT_OPTIONS = {
  ttlMs: 10 * 60 * 1000,
  maxAttempts: 5,
};

export class DefaultAuthenticationService {
  readonly transactionRepository: TransactionRepository;
  readonly providerInstanceRepository: ProviderInstanceRepository;

  userRepository: UserRepository;
  userProfileRepository: UserProfileRepository;
  userContactRepository: UserContactRepository;
  identityRepository: IdentityRepository;
  credentialRepository: CredentialRepository;
  sessionRepository: SessionRepository;
  tokenFamilyRepository: TokenFamilyRepository;
  refreshTokenRepository: RefreshTokenRepository;

  readonly registry: DefaultProviderRegistry;

  private readonly tools: DefaultAuthenticationServiceOptions['tools'];
  private readonly options: AuthenticationOptions;
  private readonly unitOfWork: TransactionRunner;

  readonly userService: UserService;
  readonly profileService: ProfileService;
  readonly identitieService: IdentityService;
  readonly sessionService: SessionService;
  readonly tokenService: TokenService;
  readonly securityPolicyService: SecurityPolicyService;

  readonly identityResolver: IdentityResolver;

  constructor(options: DefaultAuthenticationServiceOptions) {
    this.transactionRepository = options.transactionRepository;
    this.providerInstanceRepository = options.providerInstanceRepository;

    this.userRepository = options.userRepository;
    this.userProfileRepository = options.userProfileRepository;
    this.userContactRepository = options.userContactRepository;
    this.identityRepository = options.identityRepository;
    this.credentialRepository = options.credentialRepository;
    this.sessionRepository = options.sessionRepository;
    this.tokenFamilyRepository = options.tokenFamilyRepository;
    this.refreshTokenRepository = options.refreshTokenRepository;

    this.tools = options.tools;
    this.unitOfWork = options.unitOfWork;
    this.options = options.options ?? ({} as AuthenticationOptions);

    assertPositiveDuration(
      'authentication.transactionTtlMs',
      this.options.ttlMs,
    );
    assertPositiveInteger(
      'authentication.maxAttempts',
      this.options.maxAttempts,
    );

    this.registry = new DefaultProviderRegistry(
      this.providerInstanceRepository,
    );

    for (const provider of options.providers) {
      this.registry.register(provider);
    }

    const { tools } = options;

    this.userService = new UserService({
      repository: this.userRepository,
      tools,
    });

    this.profileService = new ProfileService({
      repository: this.userProfileRepository,
    });

    this.identitieService = new IdentityService({
      repository: this.identityRepository,
      events: tools.events,
      tools,
    });

    this.sessionService = new SessionService({
      repository: this.sessionRepository,
      events: tools.events,
      options: this.options.session,
      tools,
    });

    this.tokenService = new TokenService({
      repositories: {
        family: this.tokenFamilyRepository,
        refreshToken: this.refreshTokenRepository,
      },
      service: this.sessionService,
      events: tools.events,
      unitOfWork: options.unitOfWork,
      options: this.options.token,
      tools,
    });

    this.securityPolicyService = new SecurityPolicyService(
      this.options.securityPolicy,
    );

    this.identityResolver = new IdentityResolver({
      service: this.identitieService,
      userService: this.userService,
    });
  }

  async begin(request: BeginAuthenticationRequest) {
    this.assertUserProvidedWhenRequired(request);

    const { provider, instance } = await this.loadProvider(request.type);
    const now = getNow();

    const transaction: AuthenticationTransaction = {
      id: this.tools.generateId(),
      providerInstanceId: instance.id,
      clientId: request.clientId,
      userId: request.userId,
      purpose: request.purpose,
      status: 'pending',
      currentStep: 'begin',
      attempts: 0,
      maxAttempts: this.options.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts,
      stateHash: null,
      challengeRef: null,
      expiresAt: new Date(
        now.getTime() + (this.options.ttlMs ?? DEFAULT_OPTIONS.ttlMs),
      ),
      completedAt: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };

    await this.transactionRepository.create(transaction);

    const step = await provider.begin(
      this.toProviderContext(transaction),
      request.input,
    );

    return this.handleStep(transaction, step, 'begin');
  }

  /** Poursuit une authentification en cours (code OTP, callback OIDC...). */
  async continue(transactionId: string, input: unknown): Promise<AuthResult> {
    const transaction = await this.requireTransaction(transactionId);

    if (transaction.status !== 'pending' && transaction.status !== 'waiting') {
      throw new AuthenticationError(
        'transaction_not_active',
        `Transaction ${transactionId} : ${transaction.status}`,
      );
    }

    if (transaction.expiresAt.getTime() <= new Date().getTime()) {
      await this.save({ ...transaction, status: 'expired' }, transaction);
      throw new AuthenticationError('transaction_expired');
    }

    const { provider } = await this.loadProvider(
      transaction.providerInstanceId,
      true,
    );

    const step = await provider.continue(
      this.toProviderContext(transaction),
      input,
    );

    return this.handleStep(transaction, step, 'continue');
  }

  /** Annule une transaction en cours (sans effet si elle est déjà terminée). */
  async cancel(transactionId: string): Promise<void> {
    const transaction = await this.requireTransaction(transactionId);
    if (transaction.status === 'pending' || transaction.status === 'waiting') {
      await this.save({ ...transaction, status: 'cancelled' }, transaction);
    }
  }

  private async handleStep(
    transaction: AuthenticationTransaction,
    step: AuthStep,
    phase: Phase,
  ): Promise<AuthResult> {
    switch (step.type) {
      case 'authenticated': {
        return this.finalize(transaction, step.identity);
      }

      case 'challenge': {
        // Le challenge ne doit pas vivre plus longtemps que la transaction.
        const expiresAt = new Date(
          Math.min(transaction.expiresAt.getTime(), step.expiresAt.getTime()),
        );
        const updated = await this.save(
          {
            ...transaction,
            status: 'waiting',
            currentStep: step.challengeType,
            expiresAt,
          },
          transaction,
        );
        return {
          type: 'challenge',
          transactionId: updated.id,
          challengeType: step.challengeType,
          expiresAt: updated.expiresAt,
          publicData: step.publicData,
        };
      }

      case 'redirect': {
        const updated = await this.save(
          {
            ...transaction,
            status: 'waiting',
            currentStep: 'redirect',
          },
          transaction,
        );
        return { type: 'redirect', transactionId: updated.id, url: step.url };
      }

      case 'rejected': {
        return this.reject(transaction, step.code, step.retryable, phase);
      }
    }
  }

  /**
   * Enregistre un refus. La transaction échoue définitivement si :
   * - le refus arrive dès `begin`,
   * - le provider indique que ce n'est pas réessayable,
   * - le nombre maximal de tentatives est atteint.
   */
  private async reject(
    transaction: AuthenticationTransaction,
    code: string,
    retryable: boolean,
    phase: Phase,
  ): Promise<AuthResult> {
    // Un challenge absent peut être en cours de consommation par une requête
    // concurrente. Ne jamais réécrire ici le snapshot potentiellement ancien :
    // la requête gagnante décidera seule de l'état final de la transaction.
    if (phase === 'continue' && code === 'challenge_expired') {
      return {
        type: 'rejected',
        transactionId: transaction.id,
        code,
        retryable: false,
      };
    }

    const attempts = transaction.attempts + 1;
    const final =
      phase === 'begin' || !retryable || attempts >= transaction.maxAttempts;

    await this.save(
      {
        ...transaction,
        attempts,
        status: final ? 'failed' : 'waiting',
      },
      transaction,
    );

    await this.publish(
      SecurityEventType.AuthenticationFailed,
      transaction.userId,
      {
        transactionId: transaction.id,
        providerInstanceId: transaction.providerInstanceId,
        purpose: transaction.purpose,
        code,
      },
    );

    return {
      type: 'rejected',
      transactionId: transaction.id,
      code,
      retryable: !final,
    };
  }

  private async finalize(
    transaction: AuthenticationTransaction,
    verified: VerifiedProviderIdentity,
  ): Promise<AuthResult> {
    // Un provider ne doit jamais prouver une identité d'une autre instance.
    if (verified.providerInstanceId !== transaction.providerInstanceId) {
      await this.save({ ...transaction, status: 'failed' }, transaction);
      throw new AuthenticationError(
        'invalid_provider_response',
        "L'identité vérifiée ne correspond pas à l'instance de la transaction",
      );
    }

    const outcome = await this.applyWithRetry(transaction, verified);

    if (outcome.kind === 'rejected') {
      return this.reject(transaction, outcome.code, false, 'continue');
    }

    const now = new Date();
    await this.save(
      {
        ...transaction,
        status: 'completed',
        userId: outcome.userId,
        completedAt: now,
      },
      transaction,
    );

    if (outcome.isNewUser) {
      await this.publish(SecurityEventType.UserRegistered, outcome.userId, {
        transactionId: transaction.id,
        providerInstanceId: transaction.providerInstanceId,
      });
    }
    await this.publish(
      SecurityEventType.AuthenticationSucceeded,
      outcome.userId,
      {
        transactionId: transaction.id,
        providerInstanceId: transaction.providerInstanceId,
        purpose: transaction.purpose,
      },
    );

    return {
      type: 'authenticated',
      transactionId: transaction.id,
      userId: outcome.userId,
      isNewUser: outcome.isNewUser,
      context: {
        providerInstanceId: verified.providerInstanceId,
        methods: verified.methods,
        assuranceLevel: this.securityPolicyService.assuranceLevelFor(
          verified.methods,
        ),
        authenticatedAt: verified.authenticatedAt,
        verifiedAt: now,
      },
    };
  }

  private async requireTransaction(
    id: string,
  ): Promise<AuthenticationTransaction> {
    const transaction = await this.transactionRepository.findById(id);
    if (!transaction) {
      throw new AuthenticationError(
        'transaction_not_found',
        `Transaction ${id}`,
      );
    }
    return transaction;
  }

  private async save(
    transaction: AuthenticationTransaction,
    expected: AuthenticationTransaction,
  ): Promise<AuthenticationTransaction> {
    const updated = { ...transaction, updatedAt: getNow() };
    const saved = await this.transactionRepository.update(updated, {
      status: expected.status,
      attempts: expected.attempts,
      updatedAt: expected.updatedAt,
    });

    if (!saved) {
      throw new AuthenticationError(
        'transaction_not_active',
        `Transaction ${transaction.id} modifiée par une autre requête`,
      );
    }

    return updated;
  }

  private publish(
    eventType: SecurityEventType,
    userId: string | null,
    metadata: Metadata,
  ): Promise<void> {
    return this.tools.events.publish({
      id: this.tools.generateId(),
      userId,
      eventType,
      occurredAt: getNow(),
      metadata,
    });
  }

  /**
   * Exécute les règles métier dans une transaction de base de données.
   * Si deux requêtes créent la même identité en même temps, la base lève
   * "identity_conflict" : on réessaie une fois, et la 2e passe retrouve l'identité.
   */
  private async applyWithRetry(
    transaction: AuthenticationTransaction,
    verified: VerifiedProviderIdentity,
  ): Promise<ApplyOutcome> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.unitOfWork.run(() =>
          this.applyIdentity(transaction, verified),
        );
      } catch (error) {
        const isConflict =
          error instanceof AuthenticationError &&
          error.code === 'identity_conflict';
        if (!isConflict || attempt >= 1) throw error;
      }
    }
  }

  /** Aiguillage selon l'objectif de la transaction. */
  private async applyIdentity(
    transaction: AuthenticationTransaction,
    verified: VerifiedProviderIdentity /** : Promise<ApplyOutcome> */,
  ) {
    const resolution = await this.identityResolver.resolve(verified);

    switch (transaction.purpose) {
      case 'sign_in':
        return this.applySignIn(verified, resolution, true);
      case 'recovery':
        // Même logique qu'une connexion, mais sans création de compte.
        return this.applySignIn(verified, resolution, false);
      case 'sign_up':
        return this.applySignUp(verified, resolution);
      case 'link_identity':
        return this.applyLink(transaction, verified, resolution);
      case 'step_up':
        return this.applyStepUp(transaction, resolution);
    }
  }

  /** Connexion : identité connue -> on connecte ; inconnue -> inscription si la politique l'autorise. */
  private async applySignIn(
    verified: VerifiedProviderIdentity,
    resolution: IdentityResolution,
    mayRegister: boolean,
  ): Promise<ApplyOutcome> {
    switch (resolution.kind) {
      case 'inactive':
        return rejected('identity_disabled');

      case 'existing': {
        const { identity, user } = resolution;
        if (!this.securityPolicyService.canAuthenticate(user)) {
          return rejected('account_not_allowed');
        }
        await this.identitieService.markUsed(identity);
        await this.userService.markAuthenticated(user);
        return { kind: 'authenticated', userId: user.id, isNewUser: false };
      }

      case 'unknown':
        if (!mayRegister) return rejected('identity_not_found');
        if (!this.securityPolicyService.canAutoRegisterOnSignIn(verified)) {
          return rejected('registration_required');
        }

        return this.register(verified);
    }
  }

  /** Inscription explicite : l'identité ne doit pas déjà exister. */
  private async applySignUp(
    verified: VerifiedProviderIdentity,
    resolution: IdentityResolution,
  ): Promise<ApplyOutcome> {
    if (resolution.kind !== 'unknown') {
      return rejected('identity_already_registered');
    }
    if (!this.securityPolicyService.canRegister(verified)) {
      return rejected('registration_closed');
    }
    return this.register(verified);
  }

  /** Ajoute une identité à un utilisateur déjà connecté. */
  private async applyLink(
    transaction: AuthenticationTransaction,
    verified: VerifiedProviderIdentity,
    resolution: IdentityResolution,
  ): Promise<ApplyOutcome> {
    const user = await this.userRepository.findById(
      this.requireUserId(transaction),
    );
    if (!user) return rejected('user_not_found');

    if (!this.securityPolicyService.canLinkIdentity(user, verified)) {
      return rejected('link_not_allowed');
    }

    switch (resolution.kind) {
      case 'inactive':
        return rejected('identity_disabled');

      case 'existing':
        // Déjà liée au même utilisateur : opération idempotente.
        if (resolution.identity.userId !== user.id) {
          return rejected('identity_already_linked');
        }
        await this.identitieService.markUsed(resolution.identity);
        return { kind: 'authenticated', userId: user.id, isNewUser: false };

      case 'unknown':
        await this.identitieService.link(user.id, verified);
        return { kind: 'authenticated', userId: user.id, isNewUser: false };
    }
  }

  /** Réauthentification : l'identité prouvée doit appartenir à l'utilisateur déjà connecté. */
  private async applyStepUp(
    transaction: AuthenticationTransaction,
    resolution: IdentityResolution,
  ): Promise<ApplyOutcome> {
    const userId = this.requireUserId(transaction);

    if (
      resolution.kind !== 'existing' ||
      resolution.identity.userId !== userId
    ) {
      return rejected('identity_mismatch');
    }
    if (!this.securityPolicyService.canAuthenticate(resolution.user)) {
      return rejected('account_not_allowed');
    }

    await this.identitieService.markUsed(resolution.identity);
    return { kind: 'authenticated', userId, isNewUser: false };
  }

  /** Crée l'utilisateur, son identité et son profil (dans la même transaction DB). */
  private async register(
    verified: VerifiedProviderIdentity,
  ): Promise<ApplyOutcome> {
    const user = await this.userService.create();
    await this.identitieService.link(user.id, verified);
    await this.profileService.createFromClaims(user.id, verified.claims);
    await this.userService.markAuthenticated(user);

    // Les emails / téléphones fournis par le provider ne deviennent PAS
    // automatiquement des contacts vérifiés : leur niveau de confiance
    // doit être décidé par une politique dédiée.
    return { kind: 'authenticated', userId: user.id, isNewUser: true };
  }

  private assertUserProvidedWhenRequired(
    request: BeginAuthenticationRequest,
  ): void {
    const needsUser =
      request.purpose === 'link_identity' || request.purpose === 'step_up';
    if (needsUser && request.userId === null) {
      throw new AuthenticationError(
        'user_required',
        `Le purpose "${request.purpose}" exige un userId`,
      );
    }
  }

  /** Charge l'instance, vérifie qu'elle est active, puis retrouve son provider. */
  private async loadProvider(
    value: string,
    isID = false,
  ): Promise<{ provider: AuthenticationProvider; instance: ProviderInstance }> {
    const instance = isID
      ? await this.providerInstanceRepository.findById(value)
      : await this.providerInstanceRepository.findByType(value);

    if (!instance) {
      throw new AuthenticationError('provider_not_found', `Instance ${value}`);
    }

    if (!instance.enabled) {
      throw new AuthenticationError('provider_disabled', `Instance ${value}`);
    }

    return { provider: await this.registry.resolve(instance.id), instance };
  }

  private requireUserId(transaction: AuthenticationTransaction): string {
    if (transaction.userId === null) {
      throw new AuthenticationError(
        'user_required',
        `Transaction ${transaction.id}`,
      );
    }
    return transaction.userId;
  }

  private toProviderContext(
    transaction: AuthenticationTransaction,
  ): ProviderContext {
    return {
      transactionId: transaction.id,
      providerInstanceId: transaction.providerInstanceId,
      clientId: transaction.clientId,
      purpose: transaction.purpose,
    };
  }
}

function getNow() {
  return new Date();
}

function rejected(code: string): ApplyOutcome {
  return { kind: 'rejected', code };
}

function assertPositiveDuration(name: string, value?: number): void {
  if (typeof value == 'undefined') return;

  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${name} doit être un nombre fini strictement positif`,
    );
  }
}

function assertPositiveInteger(name: string, value?: number): void {
  if (typeof value == 'undefined') return;

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} doit être un entier strictement positif`);
  }
}
