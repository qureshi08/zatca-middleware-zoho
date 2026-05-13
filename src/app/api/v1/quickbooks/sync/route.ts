import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getValidQBToken } from '@/lib/quickbooks/server-auth';
import { mapQBInvoiceToZatca } from '@/lib/quickbooks/mapper';
import { ZatcaService } from '@/lib/zatca-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { orgId, invoiceId } = await req.json();

    if (!orgId || !invoiceId) {
      return NextResponse.json({ error: 'Missing orgId or invoiceId' }, { status: 400 });
    }

    // 1. Get OAuth Access Token
    const accessToken = await getValidQBToken(orgId);

    // 2. Fetch Invoice from QuickBooks
    const { data: config } = await supabaseAdmin
      .from('quickbooks_config')
      .select('realm_id')
      .eq('organization_id', orgId)
      .single();

    const qboUrl = `https://quickbooks.api.intuit.com/v3/company/${config.realm_id}/invoice/${invoiceId}?minorversion=65`;
    const qboResp = await fetch(qboUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!qboResp.ok) {
      throw new Error(`QuickBooks Fetch Failed: ${await qboResp.text()}`);
    }

    const qboData = await qboResp.json();
    const qbInvoice = qboData.Invoice;

    // 3. Map to ZATCA Format
    const zatcaInvoice = mapQBInvoiceToZatca(qbInvoice);

    // 4. Submit to ZATCA Engine
    // Note: ZatcaService.submitInvoice is our internal engine
    const result = await ZatcaService.submitInvoice(orgId, zatcaInvoice);

    return NextResponse.json({
      success: true,
      zatcaResult: result,
      qbInvoiceId: qbInvoice.Id
    });

  } catch (error: any) {
    console.error('[QB-SYNC-ERROR]:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
