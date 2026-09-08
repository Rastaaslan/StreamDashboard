import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedFetch, type OAuthTokens } from '../../src/oauth/authenticated-fetch.js';
import { FakeSecureTokenStore } from '../../src/oauth/token-store.js';

class Client extends AuthenticatedFetch {
  refreshes=0;
  constructor(store:FakeSecureTokenStore){super(store,'token')}
  protected async refresh(value:OAuthTokens){this.refreshes++;const next={...value,accessToken:`fresh-${this.refreshes}`,expiresAt:Date.now()+60_000};await this.writeTokens(next);return next}
  call(){return this.authorized('https://service.test')}
}
afterEach(()=>vi.unstubAllGlobals());
describe('AuthenticatedFetch',()=>{
  it('refresh un jeton expiré avant la requête',async()=>{const store=new FakeSecureTokenStore();await store.set('token',JSON.stringify({accessToken:'old',refreshToken:'r',expiresAt:0}));const fetch=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetch);const client=new Client(store);await client.call();expect(client.refreshes).toBe(1);expect(fetch.mock.calls[0]?.[1]?.headers.Authorization).toBe('Bearer fresh-1')});
  it('ne rejoue un 401 qu’une seule fois',async()=>{const store=new FakeSecureTokenStore();await store.set('token',JSON.stringify({accessToken:'old',refreshToken:'r',expiresAt:Date.now()+60_000}));const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:401})).mockResolvedValueOnce(new Response('{}',{status:200}));vi.stubGlobal('fetch',fetch);const client=new Client(store);expect((await client.call()).ok).toBe(true);expect(fetch).toHaveBeenCalledTimes(2);expect(client.refreshes).toBe(1)});
});
