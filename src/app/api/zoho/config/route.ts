import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth-service';
import { supabaseAdmin } from '@/lib/supabase';
import { ZohoClient } from '@/lib/zoho/client';

/**
 * GET /api/zoho/config
 * Retrieves Zoho Books configuration for the authenticated tenant.
 * Secrets (client secret, refresh token) are never returned.
 */
export async function GET(req: NextRequest) {
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
        return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });
    }

    const org = await AuthService.validateAPIKey(apiKey) as any;
    if (!org) {
        return NextResponse.json({ error: 'Invalid API Key' }, { status: 401 });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('zoho_config')
            .select('zoho_region, zoho_org_id, zoho_client_id, auto_submit, status, last_sync')
            .eq('organization_id', org.id)
            .maybeSingle();

        if (error) throw error;

        return NextResponse.json({
            success: true,
            config: data || {
                zoho_region: 'sa',
                zoho_org_id: '',
                zoho_client_id: '',
                auto_submit: true,
                status: 'disconnected',
            },
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

/**
 * POST /api/zoho/config
 * Handles saving config, testing connection, and verifying custom fields.
 */
export async function POST(req: NextRequest) {
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
        return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });
    }

    const org = await AuthService.validateAPIKey(apiKey) as any;
    if (!org) {
        return NextResponse.json({ error: 'Invalid API Key' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const {
            zohoRegion = 'sa',
            zohoOrgId,
            zohoClientId,
            zohoClientSecret,
            zohoRefreshToken,
            autoSubmit = true,
            action = 'save', // 'save' | 'test' | 'provision'
        } = body;

        if (!zohoRegion || !zohoOrgId || !zohoClientId) {
            return NextResponse.json({ error: 'Zoho Region, Organization ID, and Client ID are required' }, { status: 400 });
        }

        // Secrets are write-only from the UI: if omitted on test/provision/save, reuse stored values.
        let finalSecret = zohoClientSecret;
        let finalRefresh = zohoRefreshToken;
        if (!finalSecret || !finalRefresh) {
            const { data: existing } = await supabaseAdmin
                .from('zoho_config')
                .select('zoho_client_secret, zoho_refresh_token')
                .eq('organization_id', org.id)
                .maybeSingle();
            finalSecret = finalSecret || existing?.zoho_client_secret;
            finalRefresh = finalRefresh || existing?.zoho_refresh_token;
        }

        if ((!finalSecret || !finalRefresh) && (action === 'test' || action === 'provision' || action === 'save')) {
            return NextResponse.json({ error: 'Zoho Client Secret and Refresh Token are required' }, { status: 400 });
        }

        const zoho = new ZohoClient({
            zohoRegion,
            zohoOrgId,
            zohoClientId,
            zohoClientSecret: finalSecret,
            zohoRefreshToken: finalRefresh,
        });

        // ------------------------------------------
        // ACTION A: TEST CONNECTION
        // ------------------------------------------
        if (action === 'test') {
            const testResult = await zoho.testConnection();
            if (!testResult.success) {
                return NextResponse.json({ success: false, error: testResult.error }, { status: 422 });
            }
            return NextResponse.json({ success: true, message: `Zoho Books connection verified (${testResult.orgName})!` });
        }

        // ------------------------------------------
        // ACTION B: VERIFY CUSTOM FIELDS
        // ------------------------------------------
        if (action === 'provision') {
            const provResult = await zoho.provisionCustomFields();
            if (!provResult.success) {
                return NextResponse.json({
                    success: false,
                    error: 'Some recommended custom fields are missing',
                    created: provResult.created,
                    errors: provResult.errors,
                }, { status: 422 });
            }
            return NextResponse.json({
                success: true,
                message: 'All recommended ZATCA custom fields are present!',
                created: provResult.created,
            });
        }

        // ------------------------------------------
        // ACTION C: SAVE CONFIG
        // ------------------------------------------
        if (action === 'save') {
            const testResult = await zoho.testConnection();
            const configStatus = testResult.success ? 'connected' : 'disconnected';

            const dbData: Record<string, any> = {
                organization_id: org.id,
                zoho_region: zohoRegion,
                zoho_org_id: zohoOrgId,
                zoho_client_id: zohoClientId,
                auto_submit: autoSubmit,
                status: configStatus,
                updated_at: new Date().toISOString(),
            };

            // Only persist secrets when freshly supplied.
            if (zohoClientSecret) dbData.zoho_client_secret = zohoClientSecret;
            if (zohoRefreshToken) dbData.zoho_refresh_token = zohoRefreshToken;

            const { error: upsertError } = await supabaseAdmin
                .from('zoho_config')
                .upsert(dbData, { onConflict: 'organization_id' });

            if (upsertError) throw upsertError;

            if (!testResult.success) {
                return NextResponse.json({
                    success: true,
                    status: 'saved_disconnected',
                    message: `Settings saved but connection check failed: ${testResult.error}`,
                });
            }

            return NextResponse.json({
                success: true,
                status: 'saved_connected',
                message: 'Zoho Books configuration saved and connection verified successfully!',
            });
        }

        return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
