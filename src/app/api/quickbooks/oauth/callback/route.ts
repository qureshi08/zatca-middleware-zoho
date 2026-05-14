import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyOauthState } from '@/lib/quickbooks/oauth-state';

export const dynamic = 'force-dynamic';

const settingsPath = '/admin/quickbooks/settings';

function redirectWith(req: NextRequest, params: Record<string, string>): NextResponse {
    const url = new URL(settingsPath, req.url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const realmId = url.searchParams.get('realmId');
    const state = url.searchParams.get('state');

    if (!code || !state) {
        return redirectWith(req, { error: 'Missing OAuth response parameters' });
    }

    const verified = verifyOauthState(state);
    if (!verified) {
        return redirectWith(req, { error: 'OAuth state was invalid or expired. Try again.' });
    }
    const { orgId } = verified;

    try {
        const { data: config } = await supabaseAdmin
            .from('quickbooks_config')
            .select('*')
            .eq('organization_id', orgId)
            .maybeSingle();

        if (!config) {
            throw new Error('QuickBooks configuration not found for this organization.');
        }

        const redirectUri = `${url.origin}/api/quickbooks/oauth/callback`;
        const authHeader = Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64');

        const resp = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
            method: 'POST',
            headers: {
                Authorization: `Basic ${authHeader}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
            }),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error_description || 'Token exchange with QuickBooks failed');
        }

        const data = await resp.json();
        if (!data.access_token || !data.refresh_token) {
            throw new Error('QuickBooks did not return access + refresh tokens');
        }

        await supabaseAdmin
            .from('quickbooks_config')
            .update({
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                token_expires_at: Date.now() + (data.expires_in || 3600) * 1000,
                realm_id: realmId || config.realm_id,
                is_connected: true,
                updated_at: new Date().toISOString(),
            })
            .eq('organization_id', orgId);

        return redirectWith(req, { success: 'true' });
    } catch (e: any) {
        console.error('[QB-OAUTH-CALLBACK]:', e.message);
        return redirectWith(req, { error: e.message });
    }
}
