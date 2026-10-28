import { and, eq } from 'drizzle-orm';
import type {
  Credential,
  CredentialRepository,
  CredentialStatus,
} from '../../domain/user/credential.js';
import type { PostgresClient } from './client.js';
import { credentials } from './schema.js';

export class PostgresCredentialRepository implements CredentialRepository {
  constructor(private readonly client: PostgresClient) {}

  async findById(id: string): Promise<Credential | null> {
    const [row] = await this.client.db
      .select()
      .from(credentials)
      .where(eq(credentials.id, id))
      .limit(1);
    return row ?? null;
  }

  listByUserId(
    userId: string,
    filter: { type?: string; status?: CredentialStatus } = {},
  ): Promise<Credential[]> {
    return this.client.db
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.userId, userId),
          filter.type === undefined
            ? undefined
            : eq(credentials.type, filter.type),
          filter.status === undefined
            ? undefined
            : eq(credentials.status, filter.status),
        ),
      );
  }

  async create(credential: Credential): Promise<void> {
    await this.client.db.insert(credentials).values(credential);
  }

  async update(
    credential: Credential,
    expectedUpdatedAt: Date,
  ): Promise<boolean> {
    const { id, ...values } = credential;
    const rows = await this.client.db
      .update(credentials)
      .set(values)
      .where(
        and(
          eq(credentials.id, id),
          eq(credentials.updatedAt, expectedUpdatedAt),
        ),
      )
      .returning({ id: credentials.id });
    return rows.length > 0;
  }
}
