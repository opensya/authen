import { randomUUID } from 'node:crypto';
import type {
  ProviderInstance,
  ProviderInstanceRepository,
} from '../../domain/provider.js';
import {
  COLLECTIONS,
  fromDoc,
  type MongoContext,
  replacement,
  toDoc,
} from './context.js';

export class MongoProviderInstanceRepository implements ProviderInstanceRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get instances() {
    return this.ctx.collection(COLLECTIONS.providerInstances);
  }

  async findById(id: string): Promise<ProviderInstance | null> {
    return fromDoc<ProviderInstance>(
      await this.instances.findOne({ _id: id }, this.ctx.options),
    );
  }

  async findByType(type: string): Promise<ProviderInstance | null> {
    return fromDoc<ProviderInstance>(
      await this.instances.findOne(
        { type },
        { ...this.ctx.options, sort: { createdAt: 1 } },
      ),
    );
  }

  async create(
    instance: Omit<ProviderInstance, 'id'>,
  ): Promise<ProviderInstance> {
    const created: ProviderInstance = { ...instance, id: randomUUID() };
    await this.instances.insertOne(toDoc(created), this.ctx.options);
    return created;
  }

  async update(
    instance: ProviderInstance,
    expectedUpdatedAt: Date,
  ): Promise<boolean> {
    const result = await this.instances.replaceOne(
      { _id: instance.id, updatedAt: expectedUpdatedAt },
      replacement(instance),
      this.ctx.options,
    );
    return result.matchedCount > 0;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.instances.deleteOne(
      { _id: id },
      this.ctx.options,
    );
    return result.deletedCount > 0;
  }

  async list(
    filter: { type?: string; enabled?: boolean } = {},
  ): Promise<ProviderInstance[]> {
    const docs = await this.instances
      .find(
        {
          ...(filter.type === undefined ? {} : { type: filter.type }),
          ...(filter.enabled === undefined ? {} : { enabled: filter.enabled }),
        },
        this.ctx.options,
      )
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map((d) => fromDoc<ProviderInstance>(d) as ProviderInstance);
  }
}
