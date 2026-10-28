import { Timestamps } from '../../shared/types.js';

export type UserStatus = 'pending' | 'active' | 'suspended' | 'disabled';

export interface User extends Timestamps {
  id: string;
  status: UserStatus;
  lastAuthenticatedAt: Date | null;
  disabledAt: Date | null;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  create(user: User): Promise<void>;
  /** Verrou optimiste : `false` si l'utilisateur n'existe pas ou a changé entre-temps. */
  update(user: User): Promise<boolean>;
}
