import type {
  ContactType,
  UserContact,
  UserContactRepository,
} from '../../domain/user/contact.js';
import {
  COLLECTIONS,
  fromDoc,
  type MongoContext,
  replacement,
  toDoc,
} from './context.js';

export class MongoUserContactRepository implements UserContactRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get contacts() {
    return this.ctx.collection(COLLECTIONS.userContacts);
  }

  async findById(id: string): Promise<UserContact | null> {
    return fromDoc<UserContact>(
      await this.contacts.findOne({ _id: id }, this.ctx.options),
    );
  }

  async findByNormalizedValue(
    type: ContactType,
    normalizedValue: string,
  ): Promise<UserContact | null> {
    return fromDoc<UserContact>(
      await this.contacts.findOne({ type, normalizedValue }, this.ctx.options),
    );
  }

  async listByUserId(userId: string): Promise<UserContact[]> {
    const docs = await this.contacts
      .find({ userId }, this.ctx.options)
      .toArray();
    return docs.map((d) => fromDoc<UserContact>(d) as UserContact);
  }

  async create(contact: UserContact): Promise<void> {
    await this.contacts.insertOne(toDoc(contact), this.ctx.options);
  }

  async update(
    contact: UserContact,
    expectedUpdatedAt: Date,
  ): Promise<boolean> {
    const result = await this.contacts.replaceOne(
      { _id: contact.id, updatedAt: expectedUpdatedAt },
      replacement(contact),
      this.ctx.options,
    );
    return result.matchedCount > 0;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.contacts.deleteOne({ _id: id }, this.ctx.options);
    return result.deletedCount > 0;
  }
}
