import { supabaseAdmin } from '../supabase';

export interface QBConfig {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  realmId: string;
  clientId: string;
  clientSecret: string;
}

/** Fetches and auto-refreshes QuickBooks tokens from the database */
export async function getValidQBToken(orgId: string): Promise<string> {
  const { data: config, error } = await supabaseAdmin
    .from('quickbooks_config')
    .select('*')
    .eq('organization_id', orgId)
    .single();

  if (error || !config) throw new Error('QuickBooks not configured for this organization');

  // Check if token expires in < 5 minutes
  const now = Date.now();
  if (config.token_expires_at && config.token_expires_at - now > 300000) {
    return config.access_token;
  }

  console.log(`[QB-AUTH] Refreshing token for Org: ${orgId}`);

  // Refresh Token Logic
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refresh_token,
  });

  const authHeader = Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64');

  const resp = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    await supabaseAdmin
      .from('quickbooks_config')
      .update({ is_connected: false })
      .eq('organization_id', orgId);
    throw new Error('Failed to refresh QuickBooks token');
  }

  const data = await resp.json();
  const nextExpires = Date.now() + (data.expires_in * 1000);

  await supabaseAdmin
    .from('quickbooks_config')
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: nextExpires,
      updated_at: new Date().toISOString()
    })
    .eq('organization_id', orgId);

  return data.access_token;
}
