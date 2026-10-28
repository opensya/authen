import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';

import { DefaultAuthenticationService } from '@core/application/authentication.service.js';
import { GoogleProvider } from '@core/providers/google.provider.js';

import { PhoneProvider } from '@core/providers/phone.provider.js';
import { NodeSecureRandom } from '@core/application/node-random.js';
import { HmacTokenSigner } from '@core/application/hmac-token.js';

import {
  createMongoIndexes,
  MongoContext,
  MongoProviderInstanceRepository,
  MongoTransactionRepository,
  MongoUserRepository,
  MongoUserProfileRepository,
  MongoUserContactRepository,
  MongoIdentityRepository,
  MongoCredentialRepository,
  MongoSessionRepository,
  MongoTokenFamilyRepository,
  MongoRefreshTokenRepository,
} from '@core/repositories/mongodb/index.js';

import { TransactionPurpose } from '@core/domain/transaction.js';
import { AuthResult } from '@core/domain/authentication.js';
import { AuthenticationError } from '@core/application/authentication.errors.js';

import type { SmsSender } from '@core/providers/phone.provider.js';
import {
  BeginAuthenticationDto,
  ContinueAuthenticationDto,
  RefreshTokenDto,
} from '~~/shared/schemas/authentication';

export let authService: AuthService;

class ConsoleSmsSender implements SmsSender {
  constructor(private readonly log: (line: string) => void = console.log) {}

  async send(to: string, message: string): Promise<void> {
    this.log(`[sms] → ${to}: ${message}`);
  }
}

function createAuthentication(ctx: MongoContext): DefaultAuthenticationService {
  const ISSUER = 'http://localhost:3000';

  return new DefaultAuthenticationService({
    providerInstanceRepository: new MongoProviderInstanceRepository(ctx),
    transactionRepository: new MongoTransactionRepository(ctx),

    userRepository: new MongoUserRepository(ctx),
    userProfileRepository: new MongoUserProfileRepository(ctx),
    userContactRepository: new MongoUserContactRepository(ctx),
    identityRepository: new MongoIdentityRepository(ctx),
    credentialRepository: new MongoCredentialRepository(ctx),
    sessionRepository: new MongoSessionRepository(ctx),
    tokenFamilyRepository: new MongoTokenFamilyRepository(ctx),
    refreshTokenRepository: new MongoRefreshTokenRepository(ctx),

    providers: [
      new PhoneProvider({
        sender: new ConsoleSmsSender(),
        secret: 'dev-secret',
      }),

      new GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        redirectUri: process.env.GOOGLE_REDIRECT_URI!,
      }),
    ],

    unitOfWork: ctx,

    tools: {
      generateId: randomUUID,
      events: { async publish() {} },
      random: new NodeSecureRandom(),
      token: new HmacTokenSigner({ secret: 'dev-secret', issuer: ISSUER }),
    },

    options: { token: { issuer: ISSUER, audience: ISSUER } },
  });
}

export interface RequestInfo {
  authorization?: string;
  userAgent?: string;
  ipAddress?: string;
}

/** Purposes qui ouvrent une nouvelle session. link_identity et step_up en supposent déjà une. */
const SESSION_PURPOSES = new Set<TransactionPurpose>([
  'sign_in',
  'sign_up',
  'recovery',
]);

const USER_REQUIRED_PURPOSES = new Set<TransactionPurpose>([
  'link_identity',
  'step_up',
]);

export class AuthService {
  private auth!: DefaultAuthenticationService;

  constructor() {}

  begin(dto: BeginAuthenticationDto, info: RequestInfo) {
    return this.run(async () => {
      const result = await this.auth.begin({
        type: dto.type,
        purpose: dto.purpose,
        clientId: dto.clientId,
        userId: await this.userIdFor(dto.purpose, info.authorization),
        input: dto.input,
      });
      return this.complete(result, info);
    });
  }

  continue(dto: ContinueAuthenticationDto, info: RequestInfo) {
    return this.run(async () => {
      const result = await this.auth.continue(dto.transactionId, dto.input);
      return this.complete(result, info);
    });
  }

  async refresh(dto: RefreshTokenDto) {
    const result = await this.run(() =>
      this.auth.tokenService.rotateRefreshToken(dto.refreshToken, {
        clientId: dto.clientId,
      }),
    );

    if (result.type === 'rejected') {
      throw 'UnauthorizedException';
      // new UnauthorizedException({
      //   error: 'invalid_grant',
      //   reason: result.reason,
      // });
    }
    return {
      userId: result.userId,
      sessionId: result.sessionId,
      tokens: result.tokens,
    };
  }

  /** Après une authentification réussie : ouvre la session et émet les tokens. */
  private async complete(result: AuthResult, info: RequestInfo) {
    if (result.type !== 'authenticated') return result;

    const transaction = await this.auth.transactionRepository.findById(
      result.transactionId,
    );
    if (!transaction || !SESSION_PURPOSES.has(transaction.purpose))
      return result;
    if (!transaction.clientId) throw 'BadRequestException';
    // new BadRequestException('client_required');

    const session = await this.auth.sessionService.create({
      userId: result.userId,
      context: result.context,
      device: {
        userAgent: info.userAgent ?? null,
        ipAddress: info.ipAddress ?? null,
      },
    });

    const tokens = await this.auth.tokenService.issueTokenPair({
      session,
      clientId: transaction.clientId,
      scopes: [],
    });

    return {
      type: 'authenticated' as const,
      userId: result.userId,
      isNewUser: result.isNewUser,
      sessionId: session.id,
      tokens,
    };
  }

  /** Le userId ne vient jamais du corps de la requête : il est lu dans l'access token. */
  private async userIdFor(
    purpose: TransactionPurpose,
    authorization?: string,
  ): Promise<string | null> {
    if (!USER_REQUIRED_PURPOSES.has(purpose)) return null;

    const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw 'UnauthorizedException';
    // new UnauthorizedException();

    const verification = await this.auth.tokenService.verifyAccessToken(token);
    if (!verification.valid) throw 'UnauthorizedException';
    // new UnauthorizedException();

    return verification.claims.subject;
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      console.log(error);

      if (error instanceof AuthenticationError) {
        const status = error.code.endsWith('_not_found') ? 404 : 400;
        throw 'HttpException';
        // new HttpException(
        //   { code: error.code, message: error.message },
        //   status,
        // );
      }
      throw error;
    }
  }

  async init(): Promise<void> {
    const { databaseUrl } = useRuntimeConfig();

    const mongo = new MongoClient(databaseUrl);
    await mongo.connect();
    const ctx = new MongoContext(mongo, mongo.db('authen'));

    await createMongoIndexes(ctx);

    this.auth = createAuthentication(ctx);

    const repository = this.auth.providerInstanceRepository;

    for (const { type } of this.auth.registry.list()) {
      if (await repository.findByType(type)) continue;

      const now = new Date();
      await repository.create({
        id: randomUUID(),
        type,
        enabled: true,
        configurationRef: `${type}-default`,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

authService = new AuthService();
