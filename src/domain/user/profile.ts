import type { Timestamps } from '../../shared/types.js';

export interface UserProfile extends Timestamps {
  userId: string;

  displayName: string | null;
  givenName: string | null;
  familyName: string | null;
  avatarUrl: string | null;

  locale: string | null;
  timezone: string | null;
}

export interface UserProfileRepository {
  findByUserId(userId: string): Promise<UserProfile | null>;
  create(profile: UserProfile): Promise<void>;
  update(profile: UserProfile): Promise<boolean>;
  delete(userId: string): Promise<boolean>;
}
