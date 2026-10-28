import { z } from 'zod';
import type { TransactionPurpose } from '@core/domain/transaction';

const PURPOSES = [
  'sign_in',
  'sign_up',
  'link_identity',
  'step_up',
  'recovery',
] as const satisfies readonly TransactionPurpose[];

// Equivalent of @IsDefined(): rejects undefined, accepts anything else
const defined = z.unknown().refine((v) => v !== undefined, 'Required');

export const beginAuthenticationSchema = z.object({
  /** Provider type, e.g. "phone". */
  type: z.string().min(1),
  purpose: z.enum(PURPOSES),
  clientId: z.string().min(1),
  /** Raw provider input, e.g. `{ "phoneNumber": "+212612345678" }`. */
  input: defined,
});

export const continueAuthenticationSchema = z.object({
  transactionId: z.string().min(1),
  /** e.g. `{ "code": "123456" }`. */
  input: defined,
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
  clientId: z.string().optional(),
});

export type BeginAuthenticationDto = z.infer<typeof beginAuthenticationSchema>;
export type ContinueAuthenticationDto = z.infer<
  typeof continueAuthenticationSchema
>;
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;
