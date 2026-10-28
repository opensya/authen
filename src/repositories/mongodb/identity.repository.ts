import { AuthenticationError } from '../../application/authentication.errors.js';
import type {
  Identity,
  IdentityRepository,
} from '../../domain/user/identity.js';
import {
  COLLECTIONS,
  fromDoc,
  isDuplicateKey,
  type MongoContext,
  replacement,
  toDoc,
} from './context.js';

export class MongoIdentityRepository implements IdentityRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get identities() {
    return this.ctx.collection(COLLECTIONS.identities);
  }

  async findById(id: string): Promise<Identity | null> {
    return fromDoc<Identity>(
      await this.identities.findOne({ _id: id }, this.ctx.options),
    );
  }

  async findByUserId(userId: string): Promise<Identity | null> {
    return fromDoc<Identity>(
      await this.identities.findOne(
        { userId },
        { ...this.ctx.options, sort: { createdAt: 1 } },
      ),
    );
  }

  async findByProviderSubject(
    providerInstanceId: string,
    providerSubject: string,
  ): Promise<Identity | null> {
    return fromDoc<Identity>(
      await this.identities.findOne(
        { providerInstanceId, providerSubject },
        this.ctx.options,
      ),
    );
  }

  async listByUserId(userId: string): Promise<Identity[]> {
    const docs = await this.identities
      .find({ userId }, this.ctx.options)
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map((d) => fromDoc<Identity>(d) as Identity);
  }

  async create(identity: Identity): Promise<void> {
    try {
      await this.identities.insertOne(toDoc(identity), this.ctx.options);
    } catch (error) {
      // Deux requêtes concurrentes ont créé la même identité : le retry de l'orchestrateur la retrouvera.
      if (isDuplicateKey(error)) {
        throw new AuthenticationError(
          'identity_conflict',
          `${identity.providerInstanceId}:${identity.providerSubject}`,
        );
      }
      throw error;
    }
  }

  async update(identity: Identity): Promise<boolean> {
    const result = await this.identities.replaceOne(
      { _id: identity.id },
      replacement(identity),
      this.ctx.options,
    );
    return result.matchedCount > 0;
  }
}
