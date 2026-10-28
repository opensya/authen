import type { Metadata, Timestamps } from '../../shared/types.js';

export type IdentityStatus = 'active' | 'disabled' | 'unlinked';

export interface Identity extends Timestamps {
  id: string;
  userId: string;

  providerInstanceId: string;
  providerSubject: string;

  status: IdentityStatus;
  verifiedAt: Date | null;
  lastUsedAt: Date | null;

  metadata: Metadata;
}

export interface IdentityRepository {
  findById(id: string): Promise<Identity | null>;
  findByProviderSubject(
    providerInstanceId: string,
    providerSubject: string,
  ): Promise<Identity | null>;
  findByUserId(userId: string): Promise<Identity | null>;
  listByUserId(userId: string): Promise<Identity[]>;
  create(identity: Identity): Promise<void>;
  update(identity: Identity): Promise<boolean>;
}
