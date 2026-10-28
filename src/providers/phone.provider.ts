import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type {
  AuthenticationProvider,
  AuthStep,
  ProviderContext,
  ProviderManifest,
} from '../domain/provider.js';

export interface SmsSender {
  send(to: string, message: string): Promise<void>;
}

export interface PhoneOtpRecord {
  phoneNumber: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
}

/** Stockage du challenge, clé = transactionId. */
export interface PhoneOtpStore {
  get(transactionId: string): Promise<PhoneOtpRecord | null>;
  set(transactionId: string, record: PhoneOtpRecord): Promise<void>;
  delete(transactionId: string): Promise<void>;
}

export interface PhoneProviderOptions {
  sender: SmsSender;
  store?: PhoneOtpStore;
  /** Secret HMAC pour hasher les codes au repos. */
  secret: string;
  codeLength?: number;
  ttlMs?: number;
  maxAttempts?: number;
  formatMessage?: (code: string) => string;
}

const E164 = /^\+[1-9]\d{6,14}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const mask = (phone: string): string =>
  `${phone.slice(0, 4)}${'*'.repeat(Math.max(phone.length - 6, 0))}${phone.slice(-2)}`;

export class PhoneProvider implements AuthenticationProvider {
  readonly manifest: ProviderManifest = {
    type: 'phone',
    name: 'Phone OTP',
    version: '1.0.0',
    capabilities: ['challenge'],
  };

  private readonly sender: SmsSender;
  private readonly store: PhoneOtpStore;
  private readonly secret: string;
  private readonly codeLength: number;
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly formatMessage: (code: string) => string;

  constructor(options: PhoneProviderOptions) {
    this.sender = options.sender;
    this.store = options.store ?? new InMemoryPhoneOtpStore();
    this.secret = options.secret;
    this.codeLength = options.codeLength ?? 6;
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.formatMessage =
      options.formatMessage ??
      ((code) => `Votre code de vérification : ${code}`);
  }

  async begin(context: ProviderContext, input: unknown): Promise<AuthStep> {
    const phoneNumber = isRecord(input) ? input.phoneNumber : undefined;
    if (typeof phoneNumber !== 'string' || !E164.test(phoneNumber)) {
      return {
        type: 'rejected',
        code: 'invalid_phone_number',
        retryable: true,
      };
    }

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + this.ttlMs);

    await this.store.set(context.transactionId, {
      phoneNumber,
      codeHash: this.hash(context.transactionId, phoneNumber, code),
      expiresAt,
      attempts: 0,
    });

    try {
      await this.sender.send(phoneNumber, this.formatMessage(code));
    } catch (err) {
      await this.store.delete(context.transactionId);
      throw err;
    }

    return {
      type: 'challenge',
      challengeType: 'otp',
      expiresAt,
      publicData: {
        phoneNumber: mask(phoneNumber),
        codeLength: this.codeLength,
      },
    };
  }

  async continue(context: ProviderContext, input: unknown): Promise<AuthStep> {
    const code = isRecord(input) ? input.code : undefined;
    if (typeof code !== 'string' || !/^\d+$/.test(code)) {
      return { type: 'rejected', code: 'invalid_code', retryable: true };
    }

    const record = await this.store.get(context.transactionId);

    if (!record || record.expiresAt.getTime() <= Date.now()) {
      if (record) await this.store.delete(context.transactionId);
      return { type: 'rejected', code: 'challenge_expired', retryable: false };
    }

    const expected = Buffer.from(record.codeHash, 'hex');
    const actual = Buffer.from(
      this.hash(context.transactionId, record.phoneNumber, code),
      'hex',
    );
    const valid =
      expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!valid) {
      const attempts = record.attempts + 1;
      if (attempts >= this.maxAttempts) {
        await this.store.delete(context.transactionId);
        return {
          type: 'rejected',
          code: 'too_many_attempts',
          retryable: false,
        };
      }
      await this.store.set(context.transactionId, { ...record, attempts });
      return { type: 'rejected', code: 'invalid_code', retryable: true };
    }

    await this.store.delete(context.transactionId);

    return {
      type: 'authenticated',
      identity: {
        providerInstanceId: context.providerInstanceId,
        subject: record.phoneNumber,
        claims: { phoneNumber: record.phoneNumber, phoneVerified: true },
        methods: ['sms_otp'],
        authenticatedAt: new Date(),
      },
    };
  }

  private generateCode(): string {
    return randomInt(0, 10 ** this.codeLength)
      .toString()
      .padStart(this.codeLength, '0');
  }

  private hash(
    transactionId: string,
    phoneNumber: string,
    code: string,
  ): string {
    return createHmac('sha256', this.secret)
      .update(`${transactionId}:${phoneNumber}:${code}`)
      .digest('hex');
  }
}

const g = globalThis as typeof globalThis & {
  __phoneOtpRecords?: Map<string, PhoneOtpRecord>;
};

export class InMemoryPhoneOtpStore implements PhoneOtpStore {
  private readonly records = (g.__phoneOtpRecords ??= new Map<
    string,
    PhoneOtpRecord
  >());

  async get(transactionId: string): Promise<PhoneOtpRecord | null> {
    const record = this.records.get(transactionId);
    if (!record) return null;
    if (record.expiresAt.getTime() <= Date.now()) {
      this.records.delete(transactionId);
      return null;
    }
    return { ...record };
  }

  async set(transactionId: string, record: PhoneOtpRecord): Promise<void> {
    this.records.set(transactionId, { ...record });
  }

  async delete(transactionId: string): Promise<void> {
    this.records.delete(transactionId);
  }
}
