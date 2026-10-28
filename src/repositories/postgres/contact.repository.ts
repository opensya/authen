import { and, eq } from 'drizzle-orm';
import type {
  ContactType,
  UserContact,
  UserContactRepository,
} from '../../domain/user/contact.js';
import type { PostgresClient } from './client.js';
import { userContacts } from './schema.js';

export class PostgresUserContactRepository implements UserContactRepository {
  constructor(private readonly client: PostgresClient) {}

  async findById(id: string): Promise<UserContact | null> {
    const [row] = await this.client.db
      .select()
      .from(userContacts)
      .where(eq(userContacts.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByNormalizedValue(
    type: ContactType,
    normalizedValue: string,
  ): Promise<UserContact | null> {
    const [row] = await this.client.db
      .select()
      .from(userContacts)
      .where(
        and(
          eq(userContacts.type, type),
          eq(userContacts.normalizedValue, normalizedValue),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  listByUserId(userId: string): Promise<UserContact[]> {
    return this.client.db
      .select()
      .from(userContacts)
      .where(eq(userContacts.userId, userId));
  }

  async create(contact: UserContact): Promise<void> {
    await this.client.db.insert(userContacts).values(contact);
  }

  async update(
    contact: UserContact,
    expectedUpdatedAt: Date,
  ): Promise<boolean> {
    const { id, ...values } = contact;
    const rows = await this.client.db
      .update(userContacts)
      .set(values)
      .where(
        and(
          eq(userContacts.id, id),
          eq(userContacts.updatedAt, expectedUpdatedAt),
        ),
      )
      .returning({ id: userContacts.id });
    return rows.length > 0;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.client.db
      .delete(userContacts)
      .where(eq(userContacts.id, id))
      .returning({ id: userContacts.id });
    return rows.length > 0;
  }
}
