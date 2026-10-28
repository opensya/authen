import type {
  Credential,
  CredentialRepository,
  CredentialStatus,
} from '../../domain/user/credential.js';
import {
  COLLECTIONS,
  fromDoc,
  type MongoContext,
  replacement,
  toDoc,
} from './context.js';

export class MongoCredentialRepository implements CredentialRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get credentials() {
    return this.ctx.collection(COLLECTIONS.credentials);
  }

  async findById(id: string): Promise<Credential | null> {
    return fromDoc<Credential>(
      await this.credentials.findOne({ _id: id }, this.ctx.options),
    );
  }

  async listByUserId(
    userId: string,
    filter: { type?: string; status?: CredentialStatus } = {},
  ): Promise<Credential[]> {
    const docs = await this.credentials
      .find(
        {
          userId,
          ...(filter.type === undefined ? {} : { type: filter.type }),
          ...(filter.status === undefined ? {} : { status: filter.status }),
        },
        this.ctx.options,
      )
      .toArray();
    return docs.map((d) => fromDoc<Credential>(d) as Credential);
  }

  async create(credential: Credential): Promise<void> {
    await this.credentials.insertOne(toDoc(credential), this.ctx.options);
  }

  async update(
    credential: Credential,
    expectedUpdatedAt: Date,
  ): Promise<boolean> {
    const result = await this.credentials.replaceOne(
      { _id: credential.id, updatedAt: expectedUpdatedAt },
      replacement(credential),
      this.ctx.options,
    );
    return result.matchedCount > 0;
  }
}
