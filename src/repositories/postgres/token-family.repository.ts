import { and, eq, isNull } from 'drizzle-orm';
import type { TokenFamily, TokenFamilyRepository } from '../../domain/token.js';
import type { PostgresClient } from './client.js';
import { tokenFamilies } from './schema.js';

export class PostgresTokenFamilyRepository implements TokenFamilyRepository {
  constructor(private readonly client: PostgresClient) {}

  async findById(id: string): Promise<TokenFamily | null> {
    const [row] = await this.client.db
      .select()
      .from(tokenFamilies)
      .where(eq(tokenFamilies.id, id))
      .limit(1);
    return row ?? null;
  }

  async create(family: TokenFamily): Promise<void> {
    await this.client.db.insert(tokenFamilies).values(family);
  }

  /** `false` si la famille n'existe pas ou est déjà révoquée. */
  async revoke(id: string, reason: string, revokedAt: Date): Promise<boolean> {
    const rows = await this.client.db
      .update(tokenFamilies)
      .set({ revokedAt, revocationReason: reason })
      .where(and(eq(tokenFamilies.id, id), isNull(tokenFamilies.revokedAt)))
      .returning({ id: tokenFamilies.id });
    return rows.length > 0;
  }

  async revokeBySessionId(
    sessionId: string,
    reason: string,
    revokedAt: Date,
  ): Promise<void> {
    await this.client.db
      .update(tokenFamilies)
      .set({ revokedAt, revocationReason: reason })
      .where(
        and(
          eq(tokenFamilies.sessionId, sessionId),
          isNull(tokenFamilies.revokedAt),
        ),
      );
  }
}
