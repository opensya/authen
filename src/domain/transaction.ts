import { Metadata, Timestamps } from '../shared/types.js';

export type TransactionStatus =
  'pending' | 'waiting' | 'completed' | 'failed' | 'expired' | 'cancelled';

export type TransactionPurpose =
  'sign_in' | 'sign_up' | 'link_identity' | 'step_up' | 'recovery';

export interface AuthenticationTransaction extends Timestamps {
  id: string;

  providerInstanceId: string;
  clientId: string | null;
  userId: string | null;

  purpose: TransactionPurpose;
  status: TransactionStatus;
  currentStep: string;

  attempts: number;
  maxAttempts: number;

  stateHash: string | null;
  challengeRef: string | null;

  expiresAt: Date;
  completedAt: Date | null;

  metadata: Metadata;
}

export interface TransactionRepository {
  findById(id: string): Promise<AuthenticationTransaction | null>;
  create(transaction: AuthenticationTransaction): Promise<void>;

  /**
   * L'implémentation devrait être optimiste (ex. `WHERE updated_at = ancienne valeur`)
   * pour éviter que deux `continue()` simultanés écrasent le même état.
   */
  update(
    transaction: AuthenticationTransaction,
    expected: Pick<
      AuthenticationTransaction,
      'status' | 'attempts' | 'updatedAt'
    >,
  ): Promise<boolean>;
}
