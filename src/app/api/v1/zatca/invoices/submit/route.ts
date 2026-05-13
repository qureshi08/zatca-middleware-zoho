import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth-service';
import { generateInvoiceAction } from '@/lib/zatca/actions';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/v1/zatca/invoices/submit
 *
 * The PRIMARY invoice submission endpoint for Banks.
 * - Authenticates with API Key
 * - Accepts all invoice types: standard, simplified, credit note, debit note
 * - Builds the ZATCA-compliant XML
 * - Signs cryptographically using the Bank's Production CSID
 * - Submits to ZATCA Fatoora (Clearance for Standard, Reporting for Simplified)
 * - Returns real-time ZATCA status: CLEARED, REPORTED, or REJECTED
 * - Logs the full transaction to Supabase
 *
 * Request Body:
 * {
 *   "type": "standard" | "simplified",
 *   "documentType": "388" (Invoice) | "381" (Credit Note) | "383" (Debit Note),
 *   "invoiceId": "INV-001",
 *   "buyer": { ... },
 *   "items": [ { name, quantity, unitPrice, vatCategory, vatRate } ],
 *   "originalInvoiceId": "INV-000",   // Required for Credit/Debit Notes
 *   "creditReason": "Return of goods", // Required for Credit Notes only
 * }
 */
export async function POST(req: NextRequest) {
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });

    // 1. Authenticate – validate Bank's API Key
    const organization = await AuthService.validateAPIKey(apiKey) as any;
    if (!organization) return NextResponse.json({ error: 'Invalid or revoked API Key' }, { status: 401 });

    try {
        const body = await req.json();

        // 2. Validate required fields
        const isStandard = body.type === 'standard';
        if (!body.type || !body.invoiceId || !body.items?.length || (isStandard && !body.buyer)) {
            return NextResponse.json({
                error: `Missing required fields: type, invoiceId, items ${isStandard ? ', buyer' : ''}`
            }, { status: 400 });
        }

        // 3. Generate, Sign, and Submit to ZATCA
        const result = await generateInvoiceAction(body, organization.id);

        // 4. Log the transaction to Supabase (success AND failure)
        const { error: logError } = await supabaseAdmin.from('transaction_logs').insert({
            organization_id: organization.id,
            request_type: body.type === 'simplified' ? 'reporting' : 'clearance',
            invoice_number: body.invoiceId,
            invoice_hash: result.success ? (result.data?.hash || result.data?.uuid) : null,
            status: result.success ? 'success' : 'failure',
            response_payload: {
                ...result,
                body: body // Store original request for dashboard SAR/VAT calculation
            }
        });

        if (logError) {
            console.error(`[ZATCA-DB-LOG] CRITICAL ERROR for ${body.invoiceId}:`, logError.message);
        }

        // 5. Persist to invoices table so middleware dashboard can display it
        if (result.success && result.data) {
            const invoiceStatus = result.data.status === 'CLEARED' ? 'cleared' : 
                                  result.data.status === 'REPORTED' ? 'reported' : 'cleared';
            
            // Calculate totals from items
            const items = body.items || [];
            const subtotal = items.reduce((acc: number, item: any) => acc + (item.quantity * item.unitPrice), 0);
            const vatTotal = items.reduce((acc: number, item: any) => acc + (item.quantity * item.unitPrice * (item.vatRate || 15) / 100), 0);

            // Use UPSERT to ensure we don't fail on retries and all columns are populated
            const { error: invoiceError } = await supabaseAdmin.from('invoices').upsert({
                organization_id: organization.id,
                invoice_number: body.invoiceId,
                invoice_type: body.type,
                document_type: body.documentType || '388',
                status: invoiceStatus,
                total_amount: subtotal + vatTotal,
                zatca_status: result.data.status,
                zatca_uuid: result.data.uuid,
                qr_code: result.data.qrCode,
                xml: result.data.xml,
                payload: {
                    ...body,
                    total: subtotal + vatTotal,
                    vatAmount: vatTotal,
                    subtotal,
                    uuid: result.data.uuid,
                    hash: result.data.hash,
                    zatcaStatus: result.data.status,
                    qrCode: result.data.qrCode,
                    xml: result.data.xml,
                },
            }, { 
                onConflict: 'organization_id, invoice_number' 
            });

            if (invoiceError) {
                console.error(`[ZATCA-INVOICE-PERSIST] CRITICAL Error for ${body.invoiceId}:`, invoiceError.message, invoiceError.code);
                
                // Fallback: If upsert failed due to missing constraint, try simple insert
                if (invoiceError.code === '42703' || invoiceError.code === '42P10') {
                     await supabaseAdmin.from('invoices').insert({
                        organization_id: organization.id,
                        invoice_number: body.invoiceId,
                        invoice_type: body.type,
                        document_type: body.documentType || '388',
                        status: invoiceStatus,
                        total_amount: subtotal + vatTotal,
                        payload: { ...body, total: subtotal + vatTotal }
                     });
                }
            }
        }

        if (!result.success) {
            return NextResponse.json({
                success: false,
                error: result.error
            }, { status: 422 });
        }

        // 5. Return clean, transparent response to the Bank
        const data = result.data!;
        return NextResponse.json({
            success: true,
            invoiceId: data.id,
            uuid: data.uuid,
            zatcaStatus: data.status,        // ← "CLEARED" | "REPORTED"
            validationMessages: data.validationMessages ?? [],
            qrCode: data.qrCode,             // ← Base64 QR PNG for printing
            invoiceHash: data.hash,
            signedXml: Buffer.from(data.xml).toString('base64'), // ← Base64 XML
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
