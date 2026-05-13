import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');

  if (!code || state !== 'quickbooks_oauth') {
    return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 });
  }

  try {
    // 1. Find the organization that initiated the request
    // For this implementation, we fetch the latest updated config that isn't connected yet
    const { data: config, error: configError } = await supabaseAdmin
      .from('quickbooks_config')
      .select('*')
      .eq('is_connected', false)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (configError || !config) {
      throw new Error('No pending QuickBooks configuration found. Save your Client ID/Secret first.');
    }

    // 2. Exchange Code for Tokens on the Server
    const redirectUri = `${url.origin}/api/quickbooks/oauth/callback`;
    const authHeader = Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64');
    
    const resp = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error_description || 'Token exchange failed');
    }

    const data = await resp.json();

    // 3. Save Tokens to Supabase
    await supabaseAdmin
      .from('quickbooks_config')
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_expires_at: Date.now() + data.expires_in * 1000,
        realm_id: realmId || config.realm_id,
        is_connected: true,
        updated_at: new Date().toISOString()
      })
      .eq('organization_id', config.organization_id);

    // 4. Redirect back to UI with success
    return NextResponse.redirect(new URL('/admin/quickbooks/settings?success=true', req.url));

  } catch (e: any) {
    console.error('[QB-OAUTH-FATAL]:', e.message);
    return NextResponse.redirect(new URL(`/admin/quickbooks/settings?error=${encodeURIComponent(e.message)}`, req.url));
  }
}
