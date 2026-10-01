export interface StreamlabsOAuthApplication {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
}

export class StreamlabsOAuthClient {
  constructor(private readonly fetchApi: typeof fetch = fetch) {}

  authorizationUrl(input: { clientId: string; redirectUri: string; state: string }) {
    const url = new URL('https://streamlabs.com/api/v2.0/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', 'socket.token donations.create');
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async exchangeCode(input: { clientId: string; clientSecret: string; redirectUri: string; code: string }) {
    const response = await this.fetchApi('https://streamlabs.com/api/v2.0/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        code: input.code,
      }),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(streamlabsOAuthError(payload, 'Échange OAuth Streamlabs refusé.'));
    const accessToken = String(payload.access_token ?? '').trim();
    if (!accessToken || accessToken.length > 4_000) throw new Error('Streamlabs n’a pas renvoyé d’access token valide.');
    return accessToken;
  }

  async socketToken(accessToken: string) {
    const response = await this.fetchApi('https://streamlabs.com/api/v2.0/socket/token', {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(streamlabsOAuthError(payload, 'Impossible de récupérer le Socket Token Streamlabs.'));
    const socketToken = String(payload.socket_token ?? '').trim();
    if (!socketToken || socketToken.length > 4_000) throw new Error('Streamlabs n’a pas renvoyé de Socket Token valide.');
    return socketToken;
  }

  async createDonation(accessToken: string, input: { name: string; message: string; identifier: string; amount: number; currency: string; skipAlert?: boolean }) {
    const url = new URL('https://streamlabs.com/api/v2.0/donations');
    url.searchParams.set('name', input.name);
    url.searchParams.set('message', input.message);
    url.searchParams.set('identifier', input.identifier);
    url.searchParams.set('amount', String(input.amount));
    url.searchParams.set('currency', input.currency);
    url.searchParams.set('skip_alert', input.skipAlert ? 'yes' : 'no');
    const response = await this.fetchApi(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Autorisation Streamlabs insuffisante ou expirée. Clique sur « Réautoriser Streamlabs » pour accorder donations.create.');
      throw new Error(streamlabsOAuthError(payload, 'Impossible de créer la donation de test Streamlabs.'));
    }
    return payload;
  }
}

function streamlabsOAuthError(payload: Record<string, unknown>, fallback: string) {
  const code = typeof payload.error === 'string' ? payload.error.trim() : '';
  if (code === 'invalid_client') return 'Streamlabs refuse le Client ID ou le Client Secret. Recopie les identifiants de l’application puis réenregistre-les dans StreamDashboard.';
  if (code === 'invalid_grant') return 'Streamlabs refuse le code OAuth. Vérifie que la Redirect URI enregistrée est exactement celle affichée dans StreamDashboard, puis recommence la connexion.';
  const message = payload.message ?? payload.error_description ?? payload.error;
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 500) : fallback;
}
