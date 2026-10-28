import { randomBytes, randomInt } from 'node:crypto';
import type { SecureRandom } from '../ports/secure-random.js';

export class NodeSecureRandom implements SecureRandom {
  token(byteLength: number): string {
    return randomBytes(byteLength).toString('base64url');
  }

  digits(length: number): string {
    return Array.from({ length }, () => randomInt(0, 10)).join('');
  }
}
