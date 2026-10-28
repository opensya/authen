import type { Metadata, Timestamps } from '../../shared/types.js';

export type CredentialStatus = 'active' | 'revoked' | 'expired';

export interface Credential extends Timestamps {
  id: string;
  userId: string;
  identityId: string | null;

  providerInstanceId: string;
  type: string;

  status: CredentialStatus;

  secretRef: string | null;
  publicData: Metadata;

  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface CredentialRepository {
  findById(id: string): Promise<Credential | null>;
  listByUserId(
    userId: string,
    filter?: { type?: string; status?: CredentialStatus },
  ): Promise<Credential[]>;
  create(credential: Credential): Promise<void>;
  update(credential: Credential, expectedUpdatedAt: Date): Promise<boolean>;
}
