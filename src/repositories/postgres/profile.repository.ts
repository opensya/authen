import { eq } from 'drizzle-orm';
import type {
  UserProfile,
  UserProfileRepository,
} from '../../domain/user/profile.js';
import type { PostgresClient } from './client.js';
import { userProfiles } from './schema.js';

export class PostgresUserProfileRepository implements UserProfileRepository {
  constructor(private readonly client: PostgresClient) {}

  async findByUserId(userId: string): Promise<UserProfile | null> {
    const [row] = await this.client.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async create(profile: UserProfile): Promise<void> {
    await this.client.db.insert(userProfiles).values(profile);
  }

  async update(profile: UserProfile): Promise<boolean> {
    const { userId, ...values } = profile;
    const rows = await this.client.db
      .update(userProfiles)
      .set(values)
      .where(eq(userProfiles.userId, userId))
      .returning({ userId: userProfiles.userId });
    return rows.length > 0;
  }

  async delete(userId: string): Promise<boolean> {
    const rows = await this.client.db
      .delete(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .returning({ userId: userProfiles.userId });
    return rows.length > 0;
  }
}
