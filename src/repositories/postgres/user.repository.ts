import { eq } from 'drizzle-orm';
import type { User, UserRepository } from '../../domain/user/user.js';
import type { PostgresClient } from './client.js';
import { users } from './schema.js';

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly client: PostgresClient) {}

  async findById(id: string): Promise<User | null> {
    const [row] = await this.client.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  async create(user: User): Promise<void> {
    await this.client.db.insert(users).values(user);
  }

  async update(user: User): Promise<boolean> {
    const { id, ...values } = user;
    const rows = await this.client.db
      .update(users)
      .set(values)
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return rows.length > 0;
  }
}
