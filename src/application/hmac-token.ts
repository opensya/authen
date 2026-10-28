import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TokenClaims, TokenSigner } from '../ports/token.js';

export interface HmacTokenSignerOptions {
  secret: string;
  issuer: string;
}

export class HmacTokenSigner implements TokenSigner {
  private readonly secret: string;
  private readonly issuer: string;

  constructor(options: HmacTokenSignerOptions) {
    this.secret = options.secret;
    this.issuer = options.issuer;
  }

  async digest(token: string): Promise<string> {
    return createHmac('sha256', this.secret)
      .update(`digest:${token}`)
      .digest('hex');
  }

  async sign(claims: TokenClaims): Promise<string> {
    const header = encode({ alg: 'HS256', typ: 'at+jwt' });
    const payload = encode({
      iss: claims.issuer,
      sub: claims.subject,
      aud: claims.audience,
      sid: claims.sessionId,
      cid: claims.clientId,
      iat: claims.issuedAt,
      exp: claims.expiresAt,
      scope: claims.scopes.join(' '),
    });
    return `${header}.${payload}.${this.mac(`${header}.${payload}`)}`;
  }

  async verify(
    token: string,
    expectedAudience: string,
  ): Promise<TokenClaims | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts as [string, string, string];

    try {
      if (decode(header).alg !== 'HS256') return null;

      const expected = Buffer.from(this.mac(`${header}.${payload}`));
      const actual = Buffer.from(signature);
      if (
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      )
        return null;

      const { iss, sub, aud, sid, cid, iat, exp, scope } = decode(payload);
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        typeof cid !== 'string' ||
        typeof scope !== 'string' ||
        typeof iat !== 'number' ||
        typeof exp !== 'number'
      ) {
        return null;
      }
      if (iss !== this.issuer || aud !== expectedAudience) return null;
      if (exp <= Math.floor(Date.now() / 1000)) return null;

      return {
        issuer: this.issuer,
        subject: sub,
        audience: expectedAudience,
        sessionId: sid,
        clientId: cid,
        issuedAt: iat,
        expiresAt: exp,
        scopes: scope ? scope.split(' ') : [],
      };
    } catch {
      return null;
    }
  }

  private mac(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }
}

const encode = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const decode = (part: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
