import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { orgId, clientId, clientSecret, realmId } = await req.json();

    if (!orgId || !clientId || !clientSecret) {
      return NextResponse.json({ error: 'Missing required configuration fields' }, { status: 400 });
    }

    // Upsert the configuration
    const { error } = await supabaseAdmin
      .from('quickbooks_config')
      .upsert({
        organization_id: orgId,
        client_id: clientId,
        client_secret: clientSecret,
        realm_id: realmId,
        is_connected: false, // Reset connection status when keys change
        updated_at: new Date().toISOString()
      });

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Configuration saved' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'Missing orgId' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('quickbooks_config')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
