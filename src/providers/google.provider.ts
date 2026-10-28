import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import type {
  AuthenticationProvider,
  AuthStep,
  ProviderContext,
  ProviderManifest,
} from '../domain/provider.js';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface GoogleAuthRecord {
  /** SHA-256 (hex) de la partie aléatoire du `state`. */
  stateHash: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: Date;
}

/** Stockage de l'état OAuth, clé = transactionId. */
export interface GoogleAuthStore {
  get(transactionId: string): Promise<GoogleAuthRecord | null>;
  set(transactionId: string, record: GoogleAuthRecord): Promise<void>;
  delete(transactionId: string): Promise<void>;
}

export interface GoogleProviderOptions {
  clientId: string;
  clientSecret: string;
  /** Doit correspondre exactement à une URI autorisée dans la console Google. */
  redirectUri: string;
  store?: GoogleAuthStore;
  scopes?: string[];
  /** Durée de validité du aller-retour vers Google (10 min par défaut). */
  ttlMs?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

const safeEqual = (a: Buffer, b: Buffer): boolean =>
  a.length === b.length && timingSafeEqual(a, b);

const reject = (code: string): AuthStep => ({
  type: 'rejected',
  code,
  retryable: false,
});

/**
 * Connexion Google (OpenID Connect, flux "authorization code" + PKCE).
 *
 * Le `state` envoyé à Google a la forme `<transactionId>.<aléa>` : le callback HTTP
 * peut ainsi retrouver la transaction avant d'appeler `continue(transactionId, { code, state })`.
 */
export class GoogleProvider implements AuthenticationProvider {
  readonly manifest: ProviderManifest = {
    type: 'google',
    name: 'Google',
    version: '1.0.0',
    capabilities: ['redirect'],
  };

  private readonly jwks = createRemoteJWKSet(new URL(JWKS_URI));
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly store: GoogleAuthStore;
  private readonly scopes: string[];
  private readonly ttlMs: number;

  constructor(options: GoogleProviderOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    this.store = options.store ?? new InMemoryGoogleAuthStore();
    this.scopes = options.scopes ?? ['openid', 'email', 'profile'];
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
  }

  async begin(context: ProviderContext): Promise<AuthStep> {
    const random = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const state = `${context.transactionId}.${random}`;

    await this.store.set(context.transactionId, {
      stateHash: sha256(random).toString('hex'),
      nonce,
      codeVerifier,
      expiresAt: new Date(Date.now() + this.ttlMs),
    });

    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      state,
      nonce,
      code_challenge: sha256(codeVerifier).toString('base64url'),
      code_challenge_method: 'S256',
    }).toString();

    return { type: 'redirect', url: url.toString() };
  }

  async continue(context: ProviderContext, input: unknown): Promise<AuthStep> {
    if (!isRecord(input)) return reject('invalid_callback');

    if (typeof input.error === 'string') {
      await this.store.delete(context.transactionId);
      return reject(
        input.error === 'access_denied' ? 'access_denied' : 'provider_error',
      );
    }

    const { code, state } = input;
    if (typeof code !== 'string' || typeof state !== 'string' || !code) {
      return reject('invalid_callback');
    }

    const record = await this.store.get(context.transactionId);
    if (!record || record.expiresAt.getTime() <= Date.now()) {
      if (record) await this.store.delete(context.transactionId);
      return reject('challenge_expired');
    }

    const dot = state.indexOf('.');
    const validState =
      dot > 0 &&
      state.slice(0, dot) === context.transactionId &&
      safeEqual(
        Buffer.from(record.stateHash, 'hex'),
        sha256(state.slice(dot + 1)),
      );
    if (!validState) return reject('invalid_state');

    // Usage unique : le code d'autorisation et l'état ne servent qu'une fois.
    await this.store.delete(context.transactionId);

    const idToken = await this.exchange(code, record.codeVerifier);
    if (!idToken) return reject('invalid_grant');

    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: ISSUERS,
        audience: this.clientId,
        algorithms: ['RS256'],
      });

      if (
        typeof payload.sub !== 'string' ||
        typeof payload.nonce !== 'string' ||
        !safeEqual(Buffer.from(payload.nonce), Buffer.from(record.nonce))
      ) {
        return reject('invalid_id_token');
      }

      const { email, email_verified, name, picture } = payload;

      return {
        type: 'authenticated',
        identity: {
          providerInstanceId: context.providerInstanceId,
          subject: payload.sub,
          claims: {
            ...(typeof email === 'string'
              ? { email, emailVerified: email_verified === true }
              : {}),
            ...(typeof name === 'string' ? { name } : {}),
            ...(typeof picture === 'string' ? { picture } : {}),
          },
          methods: ['google'],
          authenticatedAt: new Date(),
        },
      };
    } catch (error) {
      if (error instanceof errors.JOSEError) return reject('invalid_id_token');
      throw error;
    }
  }

  /** Échange le code contre un id_token. `null` si Google refuse le code (expiré, déjà utilisé). */
  private async exchange(
    code: string,
    codeVerifier: string,
  ): Promise<string | null> {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });

    if (response.status === 400) return null;
    if (!response.ok) {
      throw new Error(`Google token endpoint: HTTP ${response.status}`);
    }

    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.id_token !== 'string') {
      throw new Error(
        'Google token endpoint: id_token manquant (scope "openid" absent ?)',
      );
    }
    return body.id_token;
  }
}

const g = globalThis as typeof globalThis & {
  __googleAuthRecords?: Map<string, GoogleAuthRecord>;
};

export class InMemoryGoogleAuthStore implements GoogleAuthStore {
  private readonly records = (g.__googleAuthRecords ??= new Map<
    string,
    GoogleAuthRecord
  >());

  async get(transactionId: string): Promise<GoogleAuthRecord | null> {
    const record = this.records.get(transactionId);
    if (!record) return null;
    if (record.expiresAt.getTime() <= Date.now()) {
      this.records.delete(transactionId);
      return null;
    }
    return { ...record };
  }

  async set(transactionId: string, record: GoogleAuthRecord): Promise<void> {
    this.records.set(transactionId, { ...record });
  }

  async delete(transactionId: string): Promise<void> {
    this.records.delete(transactionId);
  }
}
