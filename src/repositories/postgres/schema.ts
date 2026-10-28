import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { AuthenticationContext } from '../../domain/authentication.js';
import type { DeviceInfo, SessionStatus } from '../../domain/session.js';
import type {
  TransactionPurpose,
  TransactionStatus,
} from '../../domain/transaction.js';
import type { ContactType } from '../../domain/user/contact.js';
import type { CredentialStatus } from '../../domain/user/credential.js';
import type { IdentityStatus } from '../../domain/user/identity.js';
import type { UserStatus } from '../../domain/user/user.js';
import type { Metadata } from '../../shared/types.js';

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

/** `context` est stocké en jsonb : les dates y sont des chaînes ISO. */
export type StoredContext = Omit<
  AuthenticationContext,
  'authenticatedAt' | 'verifiedAt'
> & { authenticatedAt: string; verifiedAt: string };

export const providerInstances = pgTable(
  'provider_instances',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    enabled: boolean('enabled').notNull(),
    configurationRef: text('configuration_ref').notNull(),
    metadata: jsonb('metadata').$type<Metadata>().notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('provider_instances_type_idx').on(t.type)],
);

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  status: text('status').$type<UserStatus>().notNull(),
  lastAuthenticatedAt: ts('last_authenticated_at'),
  disabledAt: ts('disabled_at'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const userProfiles = pgTable('user_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  displayName: text('display_name'),
  givenName: text('given_name'),
  familyName: text('family_name'),
  avatarUrl: text('avatar_url'),
  locale: text('locale'),
  timezone: text('timezone'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const userContacts = pgTable(
  'user_contacts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').$type<ContactType>().notNull(),
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    isPrimary: boolean('is_primary').notNull(),
    verifiedAt: ts('verified_at'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    index('user_contacts_user_idx').on(t.userId),
    index('user_contacts_lookup_idx').on(t.type, t.normalizedValue),
  ],
);

export const identities = pgTable(
  'identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    providerInstanceId: text('provider_instance_id')
      .notNull()
      .references(() => providerInstances.id),
    providerSubject: text('provider_subject').notNull(),
    status: text('status').$type<IdentityStatus>().notNull(),
    verifiedAt: ts('verified_at'),
    lastUsedAt: ts('last_used_at'),
    metadata: jsonb('metadata').$type<Metadata>().notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    // Garantit l'unicité de (instance, subject) : sert de base à "identity_conflict".
    uniqueIndex('identities_provider_subject_uq').on(
      t.providerInstanceId,
      t.providerSubject,
    ),
    index('identities_user_idx').on(t.userId),
  ],
);

export const credentials = pgTable(
  'credentials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    identityId: text('identity_id').references(() => identities.id),
    providerInstanceId: text('provider_instance_id')
      .notNull()
      .references(() => providerInstances.id),
    type: text('type').notNull(),
    status: text('status').$type<CredentialStatus>().notNull(),
    secretRef: text('secret_ref'),
    publicData: jsonb('public_data').$type<Metadata>().notNull(),
    expiresAt: ts('expires_at'),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('credentials_user_idx').on(t.userId)],
);

export const authenticationTransactions = pgTable(
  'authentication_transactions',
  {
    id: text('id').primaryKey(),
    providerInstanceId: text('provider_instance_id')
      .notNull()
      .references(() => providerInstances.id),
    clientId: text('client_id'),
    userId: text('user_id').references(() => users.id),
    purpose: text('purpose').$type<TransactionPurpose>().notNull(),
    status: text('status').$type<TransactionStatus>().notNull(),
    currentStep: text('current_step').notNull(),
    attempts: integer('attempts').notNull(),
    maxAttempts: integer('max_attempts').notNull(),
    stateHash: text('state_hash'),
    challengeRef: text('challenge_ref'),
    expiresAt: ts('expires_at').notNull(),
    completedAt: ts('completed_at'),
    metadata: jsonb('metadata').$type<Metadata>().notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('authentication_transactions_expires_idx').on(t.expiresAt)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').$type<SessionStatus>().notNull(),
    context: jsonb('context').$type<StoredContext>().notNull(),
    device: jsonb('device').$type<DeviceInfo>().notNull(),
    authenticatedAt: ts('authenticated_at').notNull(),
    lastActivityAt: ts('last_activity_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    absoluteExpiresAt: ts('absolute_expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revocationReason: text('revocation_reason'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const tokenFamilies = pgTable(
  'token_families',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    clientId: text('client_id').notNull(),
    scopes: text('scopes').array().notNull(),
    createdAt: ts('created_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revocationReason: text('revocation_reason'),
  },
  (t) => [index('token_families_session_idx').on(t.sessionId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => tokenFamilies.id),
    tokenHash: text('token_hash').notNull(),
    issuedAt: ts('issued_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    revokedAt: ts('revoked_at'),
    replacedByTokenId: text('replaced_by_token_id'),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);
