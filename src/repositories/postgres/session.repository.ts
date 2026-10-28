import { and, desc, eq } from 'drizzle-orm';
import type {
  Session,
  SessionRepository,
  SessionStatus,
} from '../../domain/session.js';
import type { PostgresClient } from './client.js';
import { sessions } from './schema.js';

type Row = typeof sessions.$inferSelect;

/** Le `context` est en jsonb : ses dates sont sérialisées en ISO et reconverties ici. */
const fromRow = (row: Row): Session => ({
  ...row,
  context: {
    ...row.context,
    authenticatedAt: new Date(row.context.authenticatedAt),
    verifiedAt: new Date(row.context.verifiedAt),
  },
});

const toRow = (session: Session): typeof sessions.$inferInsert => ({
  ...session,
  context: {
    ...session.context,
    authenticatedAt: session.context.authenticatedAt.toISOString(),
    verifiedAt: session.context.verifiedAt.toISOString(),
  },
});

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly client: PostgresClient) {}

  async findById(id: string): Promise<Session | null> {
    const [row] = await this.client.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    return row ? fromRow(row) : null;
  }

  async listByUserId(
    userId: string,
    filter: { status?: SessionStatus } = {},
  ): Promise<Session[]> {
    const rows = await this.client.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          filter.status === undefined
            ? undefined
            : eq(sessions.status, filter.status),
        ),
      )
      .orderBy(desc(sessions.createdAt));
    return rows.map(fromRow);
  }

  async create(session: Session): Promise<void> {
    await this.client.db.insert(sessions).values(toRow(session));
  }

  async update(session: Session): Promise<boolean> {
    const { id, ...values } = toRow(session);
    const rows = await this.client.db
      .update(sessions)
      .set(values)
      .where(eq(sessions.id, id))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }
}
