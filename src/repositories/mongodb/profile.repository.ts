import type {
  UserProfile,
  UserProfileRepository,
} from '../../domain/user/profile.js';
import {
  COLLECTIONS,
  fromDoc,
  type MongoContext,
  replacement,
  toDoc,
} from './context.js';

export class MongoUserProfileRepository implements UserProfileRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get profiles() {
    return this.ctx.collection(COLLECTIONS.userProfiles);
  }

  async findByUserId(userId: string): Promise<UserProfile | null> {
    return fromDoc<UserProfile>(
      await this.profiles.findOne({ _id: userId }, this.ctx.options),
      'userId',
    );
  }

  async create(profile: UserProfile): Promise<void> {
    await this.profiles.insertOne(toDoc(profile, 'userId'), this.ctx.options);
  }

  async update(profile: UserProfile): Promise<boolean> {
    const result = await this.profiles.replaceOne(
      { _id: profile.userId },
      replacement(profile, 'userId'),
      this.ctx.options,
    );
    return result.matchedCount > 0;
  }

  async delete(userId: string): Promise<boolean> {
    const result = await this.profiles.deleteOne(
      { _id: userId },
      this.ctx.options,
    );
    return result.deletedCount > 0;
  }
}
