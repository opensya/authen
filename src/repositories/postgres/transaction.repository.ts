import { and, eq } from 'drizzle-orm';
import type {
  AuthenticationTransaction,
  TransactionRepository,
} from '../../domain/transaction.js';
import type { PostgresClient } from './client.js';
import { authenticationTransactions as transactions } from './schema.js';

export class PostgresTransactionRepository implements TransactionRepository {
  constructor(private readonly client: PostgresClient) {}

  async findById(id: string): Promise<AuthenticationTransaction | null> {
    const [row] = await this.client.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .limit(1);
    return row ?? null;
  }

  async create(transaction: AuthenticationTransaction): Promise<void> {
    await this.client.db.insert(transactions).values(transaction);
  }

  /** Compare-and-swap : n'écrit que si status, attempts et updatedAt n'ont pas bougé. */
  async update(
    transaction: AuthenticationTransaction,
    expected: Pick<
      AuthenticationTransaction,
      'status' | 'attempts' | 'updatedAt'
    >,
  ): Promise<boolean> {
    const { id, ...values } = transaction;
    const rows = await this.client.db
      .update(transactions)
      .set(values)
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.status, expected.status),
          eq(transactions.attempts, expected.attempts),
          eq(transactions.updatedAt, expected.updatedAt),
        ),
      )
      .returning({ id: transactions.id });
    return rows.length > 0;
  }
}
