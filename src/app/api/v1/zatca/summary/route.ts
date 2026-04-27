import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth-service';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * ANALYTICS ENGINE: LIVE INTELLIGENCE
 * 
 * GET - Calculate real-time VAT volume, SAR flow, and success rates
 * for the institutional dashboard.
 */

export async function GET(req: NextRequest) {
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });

    const org = await AuthService.validateAPIKey(apiKey) as any;
    if (!org) return NextResponse.json({ error: 'Invalid API Key' }, { status: 401 });

    try {
        // 1. Fetch Cleared Invoices from invoices table
        const { data: invoices, error: invoiceError } = await supabaseAdmin
            .from('invoices')
            .select('*')
            .eq('organization_id', org.id);

        if (invoiceError) throw invoiceError;

        // 2. Fetch Submitted Invoices from transaction_logs table
        const { data: transactions, error: transactionError } = await supabaseAdmin
            .from('transaction_logs')
            .select('*')
            .eq('organization_id', org.id)
            .eq('status', 'success');

        if (transactionError) throw transactionError;

        // 3. Calculate metrics — both 'cleared' and 'reported' are successful ZATCA submissions
        const clearedInvoices = invoices?.filter(inv => ['cleared', 'reported'].includes(inv.status)) || [];
        const submittedCount = transactions?.length || 0;
        const clearedCount = clearedInvoices.length;
        const totalCount = submittedCount; // Total submitted from bank app

        let totalSAR = 0;
        let totalVAT = 0;

        clearedInvoices.forEach(inv => {
            // SAFE EXTRACTION: total_amount might be missing from schema, fallback to payload
            const rawAmount = inv.total_amount || inv.payload?.total || 0;
            const amount = parseFloat(rawAmount.toString());

            // Calculate VAT from items
            const items = inv.payload?.items || [];
            const vat = items.reduce((acc: number, item: any) => acc + (item.quantity * item.unitPrice * (item.vatRate / 100)), 0);

            totalSAR += amount;
            totalVAT += vat;
        });

        const successRate = totalCount > 0 ? (clearedCount / totalCount) * 100 : 0;

        // 2. Fetch Recent Ledger (Last 5)
        const { data: recent } = await supabaseAdmin
            .from('invoices')
            .select('*')
            .eq('organization_id', org.id)
            .order('created_at', { ascending: false })
            .limit(5);

        return NextResponse.json({
            success: true,
            summary: {
                total: totalCount,
                submittedCount: submittedCount,
                clearedCount: clearedCount,
                totalVolumeSAR: totalSAR.toFixed(2),
                totalVatCollected: totalVAT.toFixed(2),
                successRate: `${successRate.toFixed(1)}%`
            },
            recent: recent || []
        });

    } catch (e: any) {
        console.error('[ANALYTICS-ERROR]:', e);
        return NextResponse.json({ error: 'Failed to aggregate live metrics', details: e.message }, { status: 500 });
    }
}
