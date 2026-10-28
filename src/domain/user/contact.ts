import type { Timestamps } from '../../shared/types.js';

export type ContactType = 'email' | 'phone';

export interface UserContact extends Timestamps {
  id: string;
  userId: string;

  type: ContactType;
  value: string;
  normalizedValue: string;

  isPrimary: boolean;
  verifiedAt: Date | null;
}

export interface UserContactRepository {
  findById(id: string): Promise<UserContact | null>;
  findByNormalizedValue(type: ContactType, normalizedValue: string): Promise<UserContact | null>;
  listByUserId(userId: string): Promise<UserContact[]>;
  create(contact: UserContact): Promise<void>;
  update(contact: UserContact, expectedUpdatedAt: Date): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}
