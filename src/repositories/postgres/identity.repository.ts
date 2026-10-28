import { and, asc, eq } from 'drizzle-orm';
import { AuthenticationError } from '../../application/authentication.errors.js';
import type {
  Identity,
  IdentityRepository,
} from '../../domain/user/identity.js';
import { isUniqueViolation, type PostgresClient } from './client.js';
import { identities } from './schema.js';

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly client: PostgresClient) {}

  async findById(id: string): Promise<Identity | null> {
    const [row] = await this.client.db
      .select()
      .from(identities)
      .where(eq(identities.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByUserId(userId: string): Promise<Identity | null> {
    const [row] = await this.client.db
      .select()
      .from(identities)
      .where(eq(identities.userId, userId))
      .orderBy(asc(identities.createdAt))
      .limit(1);
    return row ?? null;
  }

  async findByProviderSubject(
    providerInstanceId: string,
    providerSubject: string,
  ): Promise<Identity | null> {
    const [row] = await this.client.db
      .select()
      .from(identities)
      .where(
        and(
          eq(identities.providerInstanceId, providerInstanceId),
          eq(identities.providerSubject, providerSubject),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  listByUserId(userId: string): Promise<Identity[]> {
    return this.client.db
      .select()
      .from(identities)
      .where(eq(identities.userId, userId))
      .orderBy(asc(identities.createdAt));
  }

  async create(identity: Identity): Promise<void> {
    try {
      await this.client.db.insert(identities).values(identity);
    } catch (error) {
      // Deux requêtes concurrentes ont créé la même identité : IdentityService / le retry le gèrent.
      if (isUniqueViolation(error)) {
        throw new AuthenticationError(
          'identity_conflict',
          `${identity.providerInstanceId}:${identity.providerSubject}`,
        );
      }
      throw error;
    }
  }

  async update(identity: Identity): Promise<boolean> {
    const { id, ...values } = identity;
    const rows = await this.client.db
      .update(identities)
      .set(values)
      .where(eq(identities.id, id))
      .returning({ id: identities.id });
    return rows.length > 0;
  }
}
