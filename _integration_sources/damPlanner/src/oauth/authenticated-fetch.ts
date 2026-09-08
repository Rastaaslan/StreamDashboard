import { ReauthRequiredError } from '../providers/contracts.js';
import type { SecureTokenStore } from './token-store.js';

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export abstract class AuthenticatedFetch {
  constructor(protected readonly tokens: SecureTokenStore, private readonly tokenKey: string) {}

  protected async readTokens(): Promise<OAuthTokens> {
    const value = await this.tokens.get(this.tokenKey);
    if (!value) throw new ReauthRequiredError('Connexion requise');
    return JSON.parse(value) as OAuthTokens;
  }

  protected async writeTokens(value: OAuthTokens): Promise<void> {
    await this.tokens.set(this.tokenKey, JSON.stringify(value));
  }

  protected async clearTokens(): Promise<void> {
    await this.tokens.delete(this.tokenKey);
  }

  protected abstract refresh(value: OAuthTokens): Promise<OAuthTokens>;

  protected async authorized(url: string, init: RequestInit = {}): Promise<Response> {
    let value = await this.readTokens();
    if (value.expiresAt <= Date.now() + 30_000) value = await this.refresh(value);
    const request = (token: string) => fetch(url, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers).entries()), Authorization: `Bearer ${token}` },
    });
    let response = await request(value.accessToken);
    if (response.status === 401) {
      value = await this.refresh(value);
      response = await request(value.accessToken); // exactly one replay
    }
    if (response.status === 401 || response.status === 403) throw new ReauthRequiredError('Autorisation expirée ou révoquée');
    return response;
  }
}

export async function jsonOrError<T>(response: Response): Promise<T> {
  if (response.ok) return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
  const body = await response.text();
  throw new Error(`API distante ${response.status}: ${body.slice(0, 300)}`);
}
