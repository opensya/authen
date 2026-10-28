import type { User, UserRepository } from '../../domain/user/user.js';
import {
  COLLECTIONS,
  fromDoc,
  type MongoContext,
  replacement,
  toDoc,
} from './context.js';

export class MongoUserRepository implements UserRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get users() {
    return this.ctx.collection(COLLECTIONS.users);
  }

  async findById(id: string): Promise<User | null> {
    return fromDoc<User>(
      await this.users.findOne({ _id: id }, this.ctx.options),
    );
  }

  async create(user: User): Promise<void> {
    await this.users.insertOne(toDoc(user), this.ctx.options);
  }

  async update(user: User): Promise<boolean> {
    const result = await this.users.replaceOne(
      { _id: user.id },
      replacement(user),
      this.ctx.options,
    );
    return result.matchedCount > 0;
  }
}
