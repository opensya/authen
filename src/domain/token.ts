/**
 * Une famille = toute la chaîne de refresh tokens d'une session pour un client.
 * Chaque rotation remplace le token précédent dans la même famille.
 * Si un ancien token réapparaît (vol possible), on révoque toute la famille.
 */
export interface TokenFamily {
  id: string;

  sessionId: string;
  clientId: string;
  /** Scopes accordés, conservés à chaque rotation. */
  scopes: string[];

  createdAt: Date;
  expiresAt: Date;

  revokedAt: Date | null;
  revocationReason: string | null;
}

export interface RefreshTokenRecord {
  id: string;
  familyId: string;

  tokenHash: string;

  issuedAt: Date;
  expiresAt: Date;

  consumedAt: Date | null;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
}

export interface TokenFamilyRepository {
  findById(id: string): Promise<TokenFamily | null>;
  create(family: TokenFamily): Promise<void>;
  /** `false` si la famille n'existe pas ou est déjà révoquée. */
  revoke(id: string, reason: string, revokedAt: Date): Promise<boolean>;
  revokeBySessionId(
    sessionId: string,
    reason: string,
    revokedAt: Date,
  ): Promise<void>;
}

export interface RefreshTokenRepository {
  findById(id: string): Promise<RefreshTokenRecord | null>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  create(record: RefreshTokenRecord): Promise<void>;

  /**
   * Marque le token comme consommé de façon atomique, uniquement s'il n'est
   * ni déjà consommé ni révoqué. `false` = réutilisation (vol possible).
   */
  consume(
    id: string,
    consumedAt: Date,
    replacedByTokenId: string,
  ): Promise<boolean>;

  revokeByFamilyId(familyId: string, revokedAt: Date): Promise<void>;
}
