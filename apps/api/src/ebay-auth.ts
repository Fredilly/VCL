import { CommerceProviderError } from './commerce.js';

type EbayTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

type CachedToken = {
  token: string;
  expiresAt: number;
};

const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;

export interface EbayAuthConfig {
  clientId: string;
  clientSecret: string;
  sandbox?: boolean;
}

function tokenEndpoint(sandbox: boolean): string {
  return sandbox
    ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
    : 'https://api.ebay.com/identity/v1/oauth2/token';
}

function browseBaseUrl(sandbox: boolean): string {
  return sandbox
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com';
}

export class EbayAuth {
  private cached: CachedToken | null = null;
  private pending: Promise<string> | null = null;
  private readonly endpoint: string;
  private readonly credentials: string;
  private readonly scope = 'https://api.ebay.com/oauth/api_scope';

  constructor(private readonly config: EbayAuthConfig) {
    this.endpoint = tokenEndpoint(config.sandbox ?? true);
    this.credentials = btoa(`${config.clientId}:${config.clientSecret}`);
  }

  private isExpired(): boolean {
    return !this.cached || Date.now() >= this.cached.expiresAt - TOKEN_SAFETY_MARGIN_MS;
  }

  async getAccessToken(): Promise<string> {
    if (!this.isExpired() && this.cached) return this.cached.token;
    if (this.pending) return this.pending;

    this.pending = this.fetchToken();
    try {
      const token = await this.pending;
      return token;
    } finally {
      this.pending = null;
    }
  }

  private async fetchToken(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${this.credentials}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: this.scope,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw new CommerceProviderError(
        error instanceof Error ? error.message : 'eBay OAuth request failed.',
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new CommerceProviderError(
        `eBay OAuth failed with HTTP ${response.status}: ${body.slice(0, 200)}`,
      );
    }

    let payload: EbayTokenResponse;
    try {
      payload = await response.json() as EbayTokenResponse;
    } catch {
      throw new CommerceProviderError('eBay OAuth returned invalid JSON.');
    }

    if (!payload.access_token) {
      throw new CommerceProviderError('eBay OAuth response missing access_token.');
    }

    this.cached = {
      token: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    };

    return payload.access_token;
  }

  getBrowseBaseUrl(): string {
    return browseBaseUrl(this.config.sandbox ?? true);
  }

  resetCache(): void {
    this.cached = null;
  }
}
