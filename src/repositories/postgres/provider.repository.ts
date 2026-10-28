import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type {
  ProviderInstance,
  ProviderInstanceRepository,
} from '../../domain/provider.js';
import type { PostgresClient } from './client.js';
import { providerInstances } from './schema.js';

export class PostgresProviderInstanceRepository implements ProviderInstanceRepository {
  constructor(private readonly client: PostgresClient) {}

  async findById(id: string): Promise<ProviderInstance | null> {
    const [row] = await this.client.db
      .select()
      .from(providerInstances)
      .where(eq(providerInstances.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByType(type: string): Promise<ProviderInstance | null> {
    const [row] = await this.client.db
      .select()
      .from(providerInstances)
      .where(eq(providerInstances.type, type))
      .orderBy(asc(providerInstances.createdAt))
      .limit(1);
    return row ?? null;
  }

  async create(
    instance: Omit<ProviderInstance, 'id'>,
  ): Promise<ProviderInstance> {
    const created: ProviderInstance = { ...instance, id: randomUUID() };
    await this.client.db.insert(providerInstances).values(created);
    return created;
  }

  async update(
    instance: ProviderInstance,
    expectedUpdatedAt: Date,
  ): Promise<boolean> {
    const { id, ...values } = instance;
    const rows = await this.client.db
      .update(providerInstances)
      .set(values)
      .where(
        and(
          eq(providerInstances.id, id),
          eq(providerInstances.updatedAt, expectedUpdatedAt),
        ),
      )
      .returning({ id: providerInstances.id });
    return rows.length > 0;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.client.db
      .delete(providerInstances)
      .where(eq(providerInstances.id, id))
      .returning({ id: providerInstances.id });
    return rows.length > 0;
  }

  list(
    filter: { type?: string; enabled?: boolean } = {},
  ): Promise<ProviderInstance[]> {
    return this.client.db
      .select()
      .from(providerInstances)
      .where(
        and(
          filter.type === undefined
            ? undefined
            : eq(providerInstances.type, filter.type),
          filter.enabled === undefined
            ? undefined
            : eq(providerInstances.enabled, filter.enabled),
        ),
      )
      .orderBy(asc(providerInstances.createdAt));
  }
}
