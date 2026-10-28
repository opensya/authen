import type { TokenFamily, TokenFamilyRepository } from '../../domain/token.js';
import { COLLECTIONS, fromDoc, type MongoContext, toDoc } from './context.js';

export class MongoTokenFamilyRepository implements TokenFamilyRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get families() {
    return this.ctx.collection(COLLECTIONS.tokenFamilies);
  }

  async findById(id: string): Promise<TokenFamily | null> {
    return fromDoc<TokenFamily>(
      await this.families.findOne({ _id: id }, this.ctx.options),
    );
  }

  async create(family: TokenFamily): Promise<void> {
    await this.families.insertOne(toDoc(family), this.ctx.options);
  }

  /** `false` si la famille n'existe pas ou est déjà révoquée. */
  async revoke(id: string, reason: string, revokedAt: Date): Promise<boolean> {
    const result = await this.families.updateOne(
      { _id: id, revokedAt: null },
      { $set: { revokedAt, revocationReason: reason } },
      this.ctx.options,
    );
    return result.modifiedCount > 0;
  }

  async revokeBySessionId(
    sessionId: string,
    reason: string,
    revokedAt: Date,
  ): Promise<void> {
    await this.families.updateMany(
      { sessionId, revokedAt: null },
      { $set: { revokedAt, revocationReason: reason } },
      this.ctx.options,
    );
  }
}
