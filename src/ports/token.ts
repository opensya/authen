/**
 * Contenu d'un access token, côté Authen (modèle interne).
 * La traduction vers les claims OAuth/OIDC (iss, sub, aud, iat, exp...)
 * est faite par l'adaptateur de protocole.
 * Les dates sont en secondes Unix.
 */
export interface TokenClaims {
  issuer: string;
  subject: string;
  audience: string;

  sessionId: string;
  clientId: string;

  issuedAt: number;
  expiresAt: number;

  scopes: string[];
}

export interface TokenSigner {
  /**
   * Condensat DÉTERMINISTE d'un jeton aléatoire à forte entropie (refresh token).
   * Même entrée = même sortie, ce qui permet de retrouver le token en base
   * à partir de la valeur reçue (SHA-256, ou HMAC-SHA-256 avec une clé serveur).
   * Un algorithme lent et salé comme argon2 ne conviendrait pas ici.
   */
  digest(token: string): Promise<string>;

  sign(claims: TokenClaims): Promise<string>;

  /**
   * Retourne `null` si le jeton est invalide : signature, algorithme non autorisé,
   * émetteur, audience ou expiration incorrects.
   * Les pannes techniques (KMS injoignable...) doivent, elles, lever une exception.
   */
  verify(token: string, expectedAudience: string): Promise<TokenClaims | null>;
}
