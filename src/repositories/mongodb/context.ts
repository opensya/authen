import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ClientSession,
  Collection,
  Db,
  Document,
  MongoClient,
} from 'mongodb';
import type { TransactionRunner } from '../../ports/transaction-runner.js';

export const COLLECTIONS = {
  providerInstances: 'provider_instances',
  users: 'users',
  userProfiles: 'user_profiles',
  userContacts: 'user_contacts',
  identities: 'identities',
  credentials: 'credentials',
  transactions: 'authentication_transactions',
  sessions: 'sessions',
  tokenFamilies: 'token_families',
  refreshTokens: 'refresh_tokens',
} as const;

/**
 * Point d'accès unique à MongoDB, partagé par tous les repositories.
 * Il sert aussi de `unitOfWork` : dans `run()`, chaque repository utilise
 * automatiquement la session transactionnelle en cours (via AsyncLocalStorage).
 * Les transactions exigent un replica set (ou un cluster Atlas).
 */
export class MongoContext implements TransactionRunner {
  private readonly storage = new AsyncLocalStorage<ClientSession>();

  constructor(
    private readonly client: MongoClient,
    readonly db: Db,
  ) {}

  collection(name: string): Collection<Document> {
    return this.db.collection(name);
  }

  /** Options à passer à chaque opération pour rejoindre la transaction en cours. */
  get options(): { session?: ClientSession } {
    const session = this.storage.getStore();
    return session ? { session } : {};
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Appel imbriqué : on rejoint la transaction existante.
    if (this.storage.getStore()) return fn();

    const session = this.client.startSession();
    try {
      // `fn` peut être rejouée par le driver sur une erreur transitoire : elle doit rester idempotente.
      return await session.withTransaction(() => this.storage.run(session, fn));
    } finally {
      await session.endSession();
    }
  }
}

/** Entité -> document Mongo : la clé d'identité devient `_id`. */
export function toDoc(entity: object, idKey = 'id'): Document {
  const { [idKey]: id, ...rest } = entity as Record<string, unknown>;
  return { _id: id, ...rest };
}

/** Document sans `_id`, pour `replaceOne`. */
export function replacement(entity: object, idKey = 'id'): Document {
  const { _id, ...rest } = toDoc(entity, idKey);
  void _id;
  return rest;
}

/** Document Mongo -> entité : `_id` redevient la clé d'identité. */
export function fromDoc<T>(doc: Document | null, idKey = 'id'): T | null {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { [idKey]: _id, ...rest } as T;
}

export function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

/** À appeler une fois au démarrage (idempotent). */
export async function createMongoIndexes(ctx: MongoContext): Promise<void> {
  const c = (name: string) => ctx.collection(name);

  await Promise.all([
    c(COLLECTIONS.providerInstances).createIndex({ type: 1 }),
    c(COLLECTIONS.userContacts).createIndex({ userId: 1 }),
    c(COLLECTIONS.userContacts).createIndex({ type: 1, normalizedValue: 1 }),
    // Garantit l'unicité de (instance, subject) : sert de base à "identity_conflict".
    c(COLLECTIONS.identities).createIndex(
      { providerInstanceId: 1, providerSubject: 1 },
      { unique: true },
    ),
    c(COLLECTIONS.identities).createIndex({ userId: 1 }),
    c(COLLECTIONS.credentials).createIndex({ userId: 1 }),
    c(COLLECTIONS.transactions).createIndex({ expiresAt: 1 }),
    c(COLLECTIONS.sessions).createIndex({ userId: 1 }),
    c(COLLECTIONS.tokenFamilies).createIndex({ sessionId: 1 }),
    c(COLLECTIONS.refreshTokens).createIndex(
      { tokenHash: 1 },
      { unique: true },
    ),
    c(COLLECTIONS.refreshTokens).createIndex({ familyId: 1 }),
  ]);
}
