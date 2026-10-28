import { VerifiedProviderIdentity } from '../domain/provider.js';
import type {
  UserProfile,
  UserProfileRepository,
} from '../domain/user/profile.js';
import { AuthenticationError } from './authentication.errors.js';

export interface ProfileServiceOptions {
  repository: UserProfileRepository;
}

/** Champs modifiables du profil (tous facultatifs). */
export type ProfileUpdate = Partial<
  Pick<
    UserProfile,
    | 'displayName'
    | 'givenName'
    | 'familyName'
    | 'avatarUrl'
    | 'locale'
    | 'timezone'
  >
>;

/** Gère les données du profil. Ne décide jamais de l'authentification. */
export class ProfileService {
  private readonly options: ProfileServiceOptions;

  constructor(options: ProfileServiceOptions) {
    this.options = options;
  }

  get(userId: string): Promise<UserProfile | null> {
    return this.options.repository.findByUserId(userId);
  }

  /**
   * Crée le profil initial à la première connexion.
   * Les claims du provider ne servent que de valeurs de départ pour l'affichage.
   */
  async createFromClaims(
    userId: string,
    claims: VerifiedProviderIdentity['claims'],
  ): Promise<UserProfile> {
    const now = new Date();

    const profile: UserProfile = {
      userId,
      displayName: claims.name ?? null,
      givenName: null,
      familyName: null,
      avatarUrl: claims.picture ?? null,
      locale: null,
      timezone: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.options.repository.create(profile);
    return profile;
  }

  async update(userId: string, input: ProfileUpdate): Promise<UserProfile> {
    const current = await this.options.repository.findByUserId(userId);
    if (!current) {
      throw new AuthenticationError('profile_not_found', `Profile ${userId}`);
    }

    const updated: UserProfile = {
      ...current,
      ...input,
      updatedAt: new Date(),
    };

    await this.options.repository.update(updated);
    return updated;
  }
}
