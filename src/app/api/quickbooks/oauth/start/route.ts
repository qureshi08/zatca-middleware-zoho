import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { signOauthState } from '@/lib/quickbooks/oauth-state';

export const dynamic = 'force-dynamic';

/**
 * Build the Intuit OAuth URL with a signed `state` carrying orgId.
 * Replaces the previous client-side URL construction that relied on a
 * hardcoded state and was vulnerable to a multi-tenant race in the callback.
 */
export async function POST(req: NextRequest) {
    try {
        const { orgId } = await req.json();
        if (!orgId) {
            return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
        }

        const { data: config } = await supabaseAdmin
            .from('quickbooks_config')
            .select('client_id')
            .eq('organization_id', orgId)
            .maybeSingle();

        if (!config?.client_id) {
            return NextResponse.json(
                { error: 'Save your QuickBooks Client ID + Secret before connecting.' },
                { status: 400 }
            );
        }

        const state = signOauthState(orgId);
        const origin = new URL(req.url).origin;
        const redirectUri = `${origin}/api/quickbooks/oauth/callback`;

        const oauthUrl = new URL('https://appcenter.intuit.com/connect/oauth2');
        oauthUrl.searchParams.set('client_id', config.client_id);
        oauthUrl.searchParams.set('redirect_uri', redirectUri);
        oauthUrl.searchParams.set('response_type', 'code');
        oauthUrl.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
        oauthUrl.searchParams.set('state', state);

        return NextResponse.json({ url: oauthUrl.toString() });
    } catch (e: any) {
        console.error('[QB-OAUTH-START]:', e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
