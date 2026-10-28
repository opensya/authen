import { AsyncLocalStorage } from 'node:async_hooks';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema.js';
import { TransactionRunner } from '@core/ports/transaction-runner.js';

export type Database = NodePgDatabase<typeof schema>;
export type Executor = Pick<
  Database,
  'select' | 'insert' | 'update' | 'delete'
>;

/**
 * Point d'accès unique à la base, partagé par tous les repositories.
 * Il sert aussi de `unitOfWork` : dans `run()`, chaque repository utilise
 * automatiquement la transaction en cours (via AsyncLocalStorage).
 */
export class PostgresClient implements TransactionRunner {
  private readonly storage = new AsyncLocalStorage<Executor>();

  constructor(private readonly database: Database) {}

  /** La transaction en cours si elle existe, sinon la connexion de base. */
  get db(): Executor {
    return this.storage.getStore() ?? this.database;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    // Appel imbriqué : on rejoint la transaction existante.
    if (this.storage.getStore()) return fn();
    return this.database.transaction((tx) => this.storage.run(tx, fn));
  }
}

/** Violation de contrainte d'unicité (SQLSTATE 23505), directe ou enveloppée par Drizzle. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return (e?.code ?? e?.cause?.code) === '23505';
}
