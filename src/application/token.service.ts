import type { Session } from '../domain/session.js';
import type {
  RefreshTokenRecord,
  RefreshTokenRepository,
  TokenFamily,
  TokenFamilyRepository,
} from '../domain/token.js';
import type { TokenClaims } from '../ports/token.js';
import type { TransactionRunner } from '../ports/transaction-runner.js';
import type { Metadata } from '../shared/types.js';
import type { DefaultAuthenticationServiceOptions } from './authentication.service.js';
import { EventPublisher, SecurityEventType } from './security-events.js';
import type { SessionService } from './session.service.js';

/* -------------------------------------------------------------------------- */
/*  Types publics                                                             */
/* -------------------------------------------------------------------------- */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Durée de vie de l'access token, en secondes. */
  expiresIn: number;
}

export interface IssueTokensInput {
  session: Session;
  clientId: string;
  scopes: string[];
}

export type RotationRejectionReason =
  | 'invalid_token'
  | 'expired'
  | 'revoked'
  | 'reuse_detected'
  | 'session_invalid';

/** Résultat d'une rotation : un refus est un cas normal (-> `invalid_grant` côté OAuth). */
export type RotationResult =
  | {
      type: 'rotated';
      tokens: TokenPair;
      userId: string;
      sessionId: string;
      clientId: string;
    }
  | { type: 'rejected'; reason: RotationRejectionReason };

export type AccessTokenVerification =
  | { valid: true; claims: TokenClaims }
  | { valid: false; reason: 'invalid_token' | 'session_invalid' };

export interface TokenServiceOptions {
  /** Émetteur (`iss`) des access tokens, ex. "https://auth.example.com". */
  issuer: string;
  /** Audience (`aud`) attendue des access tokens. */
  audience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlMs: number;
  /** Si un refresh token déjà utilisé réapparaît, révoque aussi la session entière. */
  revokeSessionOnReuse: boolean;
}

export interface TokenServiceDeps {
  repositories: {
    family: TokenFamilyRepository;
    refreshToken: RefreshTokenRepository;
  };
  service: SessionService;
  events: EventPublisher;
  unitOfWork: TransactionRunner;
  /** `issuer` et `audience` sont obligatoires : il n'existe pas de bonne valeur par défaut. */
  options: Pick<TokenServiceOptions, 'issuer' | 'audience'> &
    Partial<TokenServiceOptions>;
  tools: DefaultAuthenticationServiceOptions['tools'];
}

/* -------------------------------------------------------------------------- */
/*  Service                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_OPTIONS = {
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000,
  revokeSessionOnReuse: true,
} satisfies Partial<TokenServiceOptions>;

/** Taille du refresh token : 32 octets = 256 bits d'aléa. */
const REFRESH_TOKEN_BYTES = 32;

/** Erreur interne : sert à annuler la transaction DB quand un token est déjà consommé. */
class RefreshTokenAlreadyConsumed extends Error {}

/**
 * Émet, vérifie et fait tourner les tokens.
 * Il ne crée ni utilisateur ni session : il s'appuie sur une session existante.
 *
 * - Access token : court, signé, vérifiable sans base de données.
 * - Refresh token : opaque, aléatoire, stocké côté serveur sous forme de
 *   condensat, à usage unique (remplacé à chaque rotation).
 */
export class TokenService {
  private readonly d: TokenServiceDeps;
  private readonly options: TokenServiceOptions;

  constructor(deps: TokenServiceDeps) {
    this.d = deps;
    this.options = { ...DEFAULT_OPTIONS, ...deps.options };
    assertNonEmpty('token.issuer', this.options.issuer);
    assertNonEmpty('token.audience', this.options.audience);
    assertPositiveInteger(
      'token.accessTokenTtlSeconds',
      this.options.accessTokenTtlSeconds,
    );
    assertPositiveDuration(
      'token.refreshTokenTtlMs',
      this.options.refreshTokenTtlMs,
    );
  }

  /** Premier échange : crée une famille et renvoie access token + refresh token. */
  async issueTokenPair(input: IssueTokensInput): Promise<TokenPair> {
    const { session, clientId, scopes } = input;
    const now = new Date();

    const family: TokenFamily = {
      id: this.d.tools.generateId(),
      sessionId: session.id,
      clientId,
      scopes,
      createdAt: now,
      // La famille ne peut jamais survivre à la limite absolue de la session.
      expiresAt: session.absoluteExpiresAt,
      revokedAt: null,
      revocationReason: null,
    };

    const refresh = await this.d.unitOfWork.run(async () => {
      await this.d.repositories.family.create(family);
      return this.mintRefreshToken(family, now);
    });

    const accessToken = await this.issueAccessToken(session, clientId, scopes);

    return this.toPair(accessToken, refresh.raw);
  }

  /** Signe un access token pour une session et un client. */
  issueAccessToken(
    session: Session,
    clientId: string,
    scopes: string[],
  ): Promise<string> {
    const issuedAt = Math.floor(new Date().getTime() / 1000);

    return this.d.tools.token.sign({
      issuer: this.options.issuer,
      subject: session.userId,
      audience: this.options.audience,
      sessionId: session.id,
      clientId,
      issuedAt,
      expiresAt: issuedAt + this.options.accessTokenTtlSeconds,
      scopes,
    });
  }

  /**
   * Vérifie un access token : signature et claims, puis (par défaut) que la
   * session est encore valide. Sans ce second contrôle, un token resterait
   * utilisable après une déconnexion jusqu'à son expiration.
   */
  async verifyAccessToken(
    token: string,
    options: { checkSession?: boolean } = {},
  ): Promise<AccessTokenVerification> {
    const claims = await this.d.tools.token.verify(
      token,
      this.options.audience,
    );
    if (!claims) return { valid: false, reason: 'invalid_token' };

    if (options.checkSession ?? true) {
      const session = await this.d.service.validate(claims.sessionId);
      if (!session.valid) return { valid: false, reason: 'session_invalid' };
    }

    return { valid: true, claims };
  }

  /**
   * Échange un refresh token contre une nouvelle paire de tokens.
   * L'ancien token est consommé : s'il est présenté une seconde fois,
   * c'est un signe de vol possible et toute la famille est révoquée.
   */
  async rotateRefreshToken(
    rawToken: string,
    expected: { clientId?: string } = {},
  ): Promise<RotationResult> {
    const now = new Date();

    const tokenHash = await this.d.tools.token.digest(rawToken);
    const record = await this.d.repositories.refreshToken.findByHash(tokenHash);
    if (!record) return rejected('invalid_token');

    const family = await this.d.repositories.family.findById(record.familyId);
    if (!family) return rejected('invalid_token');

    // Le token appartient à un autre client : refus AVANT toute consommation,
    // sinon un client pourrait griller le token d'un autre.
    if (expected.clientId && family.clientId !== expected.clientId) {
      return rejected('invalid_token');
    }

    if (family.revokedAt) return rejected('revoked');

    // Token déjà consommé : réutilisation d'un ancien token.
    if (record.consumedAt) return this.handleReuse(family, record);

    if (record.revokedAt) return rejected('revoked');
    if (
      record.expiresAt.getTime() <= now.getTime() ||
      family.expiresAt.getTime() <= now.getTime()
    ) {
      return rejected('expired');
    }

    const validation = await this.d.service.validate(family.sessionId);
    if (!validation.valid) return rejected('session_invalid');
    const session = validation.session;

    let next: { raw: string; record: RefreshTokenRecord };
    try {
      // Création du successeur + consommation de l'ancien : tout ou rien.
      next = await this.d.unitOfWork.run(async () => {
        const issued = await this.mintRefreshToken(family, now);
        // const consumed = await this.d.repositories.refreshToken.markConsumed(
        //   record.id,
        //   now,
        //   issued.record.id,
        // );

        const consumed = await this.d.repositories.refreshToken.consume(
          record.id,
          now,
          issued.record.id,
        );
        // `false` = une autre requête a consommé le token entre-temps.
        if (!consumed) throw new RefreshTokenAlreadyConsumed();
        return issued;
      });
    } catch (error) {
      if (error instanceof RefreshTokenAlreadyConsumed) {
        return this.handleReuse(family, record);
      }
      throw error;
    }

    const accessToken = await this.issueAccessToken(
      session,
      family.clientId,
      family.scopes,
    );

    return {
      type: 'rotated',
      tokens: this.toPair(accessToken, next.raw),
      userId: session.userId,
      sessionId: session.id,
      clientId: family.clientId,
    };
  }

  /** Révoque une famille : plus aucun de ses refresh tokens n'est utilisable. */
  async revokeFamily(familyId: string, reason = 'revoked'): Promise<void> {
    const family = await this.d.repositories.family.findById(familyId);
    if (!family || family.revokedAt) return;

    await this.d.repositories.family.revoke(family.id, reason, new Date());
  }

  /** Révoque toutes les familles d'une session (ex. à la déconnexion). */
  async revokeBySession(
    sessionId: string,
    reason = 'session_revoked',
  ): Promise<void> {
    await this.d.repositories.family.revokeBySessionId(
      sessionId,
      reason,
      new Date(),
    );
  }

  /* ------------------------------------------------------------------------ */
  /*  Utilitaires                                                             */
  /* ------------------------------------------------------------------------ */

  /** Génère un refresh token, stocke son condensat et renvoie la valeur en clair (une seule fois). */
  private async mintRefreshToken(
    family: TokenFamily,
    now: Date,
  ): Promise<{ raw: string; record: RefreshTokenRecord }> {
    const raw = this.d.tools.random.token(REFRESH_TOKEN_BYTES);

    const record: RefreshTokenRecord = {
      id: this.d.tools.generateId(),
      familyId: family.id,
      tokenHash: await this.d.tools.token.digest(raw),
      issuedAt: now,
      expiresAt: new Date(
        Math.min(
          now.getTime() + this.options.refreshTokenTtlMs,
          family.expiresAt.getTime(),
        ),
      ),
      consumedAt: null,
      revokedAt: null,
      replacedByTokenId: null,
    };

    await this.d.repositories.refreshToken.create(record);
    return { raw, record };
  }

  /** Réutilisation détectée : on révoque la famille (et la session, selon l'option). */
  private async handleReuse(
    family: TokenFamily,
    record: RefreshTokenRecord,
  ): Promise<RotationResult> {
    await this.revokeFamily(family.id, 'refresh_token_reuse');

    let userId: string | null = null;
    if (this.options.revokeSessionOnReuse) {
      const session = await this.d.service.revoke(
        family.sessionId,
        'refresh_token_reuse',
      );
      userId = session.userId;
    }

    await this.publish(SecurityEventType.RefreshTokenReuseDetected, userId, {
      familyId: family.id,
      tokenId: record.id,
      sessionId: family.sessionId,
      clientId: family.clientId,
    });

    return rejected('reuse_detected');
  }

  private toPair(accessToken: string, refreshToken: string): TokenPair {
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.options.accessTokenTtlSeconds,
    };
  }

  private publish(
    eventType: SecurityEventType,
    userId: string | null,
    metadata: Metadata,
  ): Promise<void> {
    return this.d.events.publish({
      id: this.d.tools.generateId(),
      userId,
      eventType,
      occurredAt: new Date(),
      metadata,
    });
  }
}

function rejected(reason: RotationRejectionReason): RotationResult {
  return { type: 'rejected', reason };
}

function assertNonEmpty(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new RangeError(`${name} ne doit pas être vide`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} doit être un entier strictement positif`);
  }
}

function assertPositiveDuration(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${name} doit être un nombre fini strictement positif`,
    );
  }
}
