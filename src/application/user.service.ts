import type { User, UserRepository, UserStatus } from '../domain/user/user.js';
import { AuthenticationError } from './authentication.errors.js';
import { DefaultAuthenticationServiceOptions } from './authentication.service.js';

export interface UserServiceOptions {
  repository: UserRepository;
  tools: DefaultAuthenticationServiceOptions['tools'];
}

export interface CreateUserInput {
  /** "active" par défaut. */
  status?: UserStatus;
}

/**
 * Gère uniquement le cycle de vie du compte (créer, activer, suspendre, désactiver).
 * Il ne vérifie jamais de mot de passe et n'émet pas de token.
 */
export class UserService {
  private readonly options: UserServiceOptions;

  constructor(options: UserServiceOptions) {
    this.options = options;
  }

  async create(input: CreateUserInput = {}): Promise<User> {
    const now = new Date();
    const status = input.status ?? 'active';

    const user: User = {
      id: this.options.tools.generateId(),
      status,
      lastAuthenticatedAt: null,
      disabledAt: status === 'disabled' ? now : null,
      createdAt: now,
      updatedAt: now,
    };

    await this.options.repository.create(user);
    return user;
  }

  findById(id: string): Promise<User | null> {
    return this.options.repository.findById(id);
  }

  /** pending | suspended -> active */
  async activate(id: string): Promise<User> {
    const user = await this.requireById(id);
    if (user.status !== 'pending' && user.status !== 'suspended') {
      throw invalidTransition(user.status, 'active');
    }
    return this.save({ ...user, status: 'active', disabledAt: null });
  }

  /** active -> suspended */
  async suspend(id: string): Promise<User> {
    const user = await this.requireById(id);
    if (user.status !== 'active') {
      throw invalidTransition(user.status, 'suspended');
    }
    return this.save({ ...user, status: 'suspended' });
  }

  /** Tout statut -> disabled (idempotent). */
  async disable(id: string): Promise<User> {
    const user = await this.requireById(id);
    if (user.status === 'disabled') return user;
    return this.save({
      ...user,
      status: 'disabled',
      disabledAt: new Date(),
    });
  }

  /** Appelé après une connexion réussie. */
  markAuthenticated(user: User): Promise<User> {
    return this.save({ ...user, lastAuthenticatedAt: new Date() });
  }

  private async requireById(id: string): Promise<User> {
    const user = await this.options.repository.findById(id);
    if (!user) throw new AuthenticationError('user_not_found', `User ${id}`);
    return user;
  }

  private async save(user: User): Promise<User> {
    const updated: User = { ...user, updatedAt: new Date() };
    await this.options.repository.update(updated);
    return updated;
  }
}

function invalidTransition(from: UserStatus, to: UserStatus) {
  return new AuthenticationError(
    'invalid_user_transition',
    `Transition interdite : ${from} -> ${to}`,
  );
}
