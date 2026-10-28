import type {
  Session,
  SessionRepository,
  SessionStatus,
} from '../../domain/session.js';
import {
  COLLECTIONS,
  fromDoc,
  type MongoContext,
  replacement,
  toDoc,
} from './context.js';

export class MongoSessionRepository implements SessionRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get sessions() {
    return this.ctx.collection(COLLECTIONS.sessions);
  }

  async findById(id: string): Promise<Session | null> {
    return fromDoc<Session>(
      await this.sessions.findOne({ _id: id }, this.ctx.options),
    );
  }

  async listByUserId(
    userId: string,
    filter: { status?: SessionStatus } = {},
  ): Promise<Session[]> {
    const docs = await this.sessions
      .find(
        {
          userId,
          ...(filter.status === undefined ? {} : { status: filter.status }),
        },
        this.ctx.options,
      )
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((d) => fromDoc<Session>(d) as Session);
  }

  async create(session: Session): Promise<void> {
    await this.sessions.insertOne(toDoc(session), this.ctx.options);
  }

  async update(session: Session): Promise<boolean> {
    const result = await this.sessions.replaceOne(
      { _id: session.id },
      replacement(session),
      this.ctx.options,
    );
    return result.matchedCount > 0;
  }
}
