import { and, eq, isNull } from 'drizzle-orm';
import type {
  RefreshTokenRecord,
  RefreshTokenRepository,
} from '../../domain/token.js';
import type { PostgresClient } from './client.js';
import { refreshTokens } from './schema.js';

export class PostgresRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly client: PostgresClient) {}

  async findById(id: string): Promise<RefreshTokenRecord | null> {
    const [row] = await this.client.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const [row] = await this.client.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async create(record: RefreshTokenRecord): Promise<void> {
    await this.client.db.insert(refreshTokens).values(record);
  }

  /**
   * Atomique : un seul UPDATE conditionnel, donc deux requêtes concurrentes
   * ne peuvent pas consommer le même token. `false` = déjà consommé ou révoqué.
   */
  async consume(
    id: string,
    consumedAt: Date,
    replacedByTokenId: string,
  ): Promise<boolean> {
    const rows = await this.client.db
      .update(refreshTokens)
      .set({ consumedAt, replacedByTokenId })
      .where(
        and(
          eq(refreshTokens.id, id),
          isNull(refreshTokens.consumedAt),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id });
    return rows.length > 0;
  }

  async revokeByFamilyId(familyId: string, revokedAt: Date): Promise<void> {
    await this.client.db
      .update(refreshTokens)
      .set({ revokedAt })
      .where(
        and(
          eq(refreshTokens.familyId, familyId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }
}
