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
        // 1. Fetch all successful transactions for this organization
        // This is our source of truth for the dashboard
        const { data: transactions, error: transactionError } = await supabaseAdmin
            .from('transaction_logs')
            .select('*')
            .eq('organization_id', org.id)
            .eq('status', 'success')
            .order('created_at', { ascending: false });

        if (transactionError) throw transactionError;

        // 2. Calculate metrics from transactions
        const submittedCount = transactions?.length || 0;
        
        // Count processed (CLEARED/REPORTED) invoices
        // We look inside the response_payload to determine the ZATCA status
        const processedTransactions = transactions?.filter(t => {
            const data = t.response_payload?.data || t.response_payload || {};
            const status = (data.status || '').toUpperCase();
            return ['CLEARED', 'REPORTED', 'WARNING'].includes(status);
        }) || [];

        const processedCount = processedTransactions.length;

        let totalSAR = 0;
        let totalVAT = 0;

        processedTransactions.forEach(t => {
            const payload = t.response_payload?.data || t.response_payload || {};
            const requestBody = t.response_payload?.body || {};
            
            let total = parseFloat((payload.total || requestBody.total || 0).toString());
            let vat = parseFloat((payload.vatAmount || requestBody.vatAmount || 0).toString());
            
            // Calculate from items if missing
            if (total === 0 && (requestBody.items || payload.items)) {
                const items = requestBody.items || payload.items || [];
                items.forEach((item: any) => {
                    const lineTotal = (item.quantity || 0) * (item.unitPrice || 0);
                    const lineVat = lineTotal * ((item.vatRate || 15) / 100);
                    total += lineTotal + lineVat;
                    vat += lineVat;
                });
            }
            
            totalSAR += total;
            totalVAT += vat;
        });

        // 3. SECONDARY FALLBACK: If SAR is still 0 (due to old logs), query bank_invoices
        if (totalSAR === 0 && processedTransactions.length > 0) {
            const invNums = processedTransactions.map(t => t.invoice_number);
            const { data: bankData } = await supabaseAdmin
                .from('bank_invoices')
                .select('invoice_number, total_amount, vat_amount')
                .in('invoice_number', invNums);
            
            if (bankData) {
                bankData.forEach(bi => {
                    totalSAR += parseFloat((bi.total_amount || 0).toString());
                    totalVAT += parseFloat((bi.vat_amount || 0).toString());
                });
            }
        }

        const successRate = submittedCount > 0 ? (processedCount / submittedCount) * 100 : 0;

        // 4. Map transactions for the dashboard ledger
        // We fetch bank_invoices for the recent list to get accurate volumes
        const recentInvNums = transactions?.slice(0, 10).map(t => t.invoice_number) || [];
        const { data: recentBankData } = await supabaseAdmin
            .from('bank_invoices')
            .select('invoice_number, total_amount')
            .in('invoice_number', recentInvNums);

        const recent = transactions?.slice(0, 10).map(t => {
            const data = t.response_payload?.data || t.response_payload || {};
            const requestBody = t.response_payload?.body || {};
            const bankMatch = recentBankData?.find(b => b.invoice_number === t.invoice_number);
            
            let displayTotal = bankMatch?.total_amount || data.total || requestBody.total || 0;
            
            // Final calculation fallback
            if (displayTotal === 0 && (requestBody.items || data.items)) {
                const items = requestBody.items || data.items || [];
                items.forEach((item: any) => {
                    displayTotal += (item.quantity || 0) * (item.unitPrice || 0) * (1 + (item.vatRate || 15) / 100);
                });
            }

            return {
                id: t.id,
                invoice_number: t.invoice_number,
                created_at: t.created_at,
                status: (data.status || 'SUCCESS').toLowerCase(),
                total_amount: parseFloat(displayTotal.toString()).toFixed(2),
                payload: { ...data, total: displayTotal }
            };
        });

        return NextResponse.json({
            success: true,
            summary: {
                total: submittedCount,
                submittedCount: submittedCount,
                clearedCount: processedCount,
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
