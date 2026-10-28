import type {
  AuthenticationTransaction,
  TransactionRepository,
} from '../../domain/transaction.js';
import {
  COLLECTIONS,
  fromDoc,
  type MongoContext,
  replacement,
  toDoc,
} from './context.js';

export class MongoTransactionRepository implements TransactionRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get transactions() {
    return this.ctx.collection(COLLECTIONS.transactions);
  }

  async findById(id: string): Promise<AuthenticationTransaction | null> {
    return fromDoc<AuthenticationTransaction>(
      await this.transactions.findOne({ _id: id }, this.ctx.options),
    );
  }

  async create(transaction: AuthenticationTransaction): Promise<void> {
    await this.transactions.insertOne(toDoc(transaction), this.ctx.options);
  }

  /** Compare-and-swap : n'écrit que si status, attempts et updatedAt n'ont pas bougé. */
  async update(
    transaction: AuthenticationTransaction,
    expected: Pick<
      AuthenticationTransaction,
      'status' | 'attempts' | 'updatedAt'
    >,
  ): Promise<boolean> {
    const result = await this.transactions.replaceOne(
      {
        _id: transaction.id,
        status: expected.status,
        attempts: expected.attempts,
        updatedAt: expected.updatedAt,
      },
      replacement(transaction),
      this.ctx.options,
    );
    return result.matchedCount > 0;
  }
}
