import { Controller, Get, Param } from '@nestjs/common';
import { Public } from './public.decorator';
import * as crypto from 'crypto';

@Controller('.well-known')
export class OidcController {
  private readonly issuer: string;

  constructor() {
    this.issuer = process.env['PUBLIC_URL'] || 'https://euriskoproject.onrender.com';
  }

  @Public()
  @Get('openid-configuration')
  getOpenIdConfiguration() {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/auth/authorize`,
      token_endpoint: `${this.issuer}/auth/token`,
      jwks_uri: `${this.issuer}/.well-known/jwks.json`,
      userinfo_endpoint: `${this.issuer}/auth/userinfo`,
      revocation_endpoint: `${this.issuer}/auth/revoke`,
      response_types_supported: ['code', 'token', 'id_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      claims_supported: ['sub', 'email', 'name', 'company_id', 'role'],
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
    };
  }

  @Public()
  @Get('jwks.json')
  getJwks() {
    const publicKey = process.env['JWT_PUBLIC_KEY'] || '';
    if (!publicKey) {
      return { keys: [] };
    }

    const jwk = this.pemToJwk(publicKey);
    return {
      keys: [
        {
          kty: 'RSA',
          alg: 'RS256',
          use: 'sig',
          kid: 'eurisko-hub-key-1',
          ...jwk,
        },
      ],
    };
  }

  private pemToJwk(pem: string): Record<string, string> {
    const stripped = pem
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s/g, '');

    const der = Buffer.from(stripped, 'base64');

    return {
      n: der.subarray(33).toString('base64url'),
      e: 'AQAB',
    };
  }
}
