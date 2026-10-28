import type {
  RefreshTokenRecord,
  RefreshTokenRepository,
} from '../../domain/token.js';
import { COLLECTIONS, fromDoc, type MongoContext, toDoc } from './context.js';

export class MongoRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get tokens() {
    return this.ctx.collection(COLLECTIONS.refreshTokens);
  }

  async findById(id: string): Promise<RefreshTokenRecord | null> {
    return fromDoc<RefreshTokenRecord>(
      await this.tokens.findOne({ _id: id }, this.ctx.options),
    );
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return fromDoc<RefreshTokenRecord>(
      await this.tokens.findOne({ tokenHash }, this.ctx.options),
    );
  }

  async create(record: RefreshTokenRecord): Promise<void> {
    await this.tokens.insertOne(toDoc(record), this.ctx.options);
  }

  /**
   * Atomique : un seul `updateOne` conditionnel, donc deux requêtes concurrentes
   * ne peuvent pas consommer le même token. `false` = déjà consommé ou révoqué.
   */
  async consume(
    id: string,
    consumedAt: Date,
    replacedByTokenId: string,
  ): Promise<boolean> {
    const result = await this.tokens.updateOne(
      { _id: id, consumedAt: null, revokedAt: null },
      { $set: { consumedAt, replacedByTokenId } },
      this.ctx.options,
    );
    return result.modifiedCount > 0;
  }

  async revokeByFamilyId(familyId: string, revokedAt: Date): Promise<void> {
    await this.tokens.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt } },
      this.ctx.options,
    );
  }
}
