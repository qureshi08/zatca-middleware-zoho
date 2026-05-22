import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth-service';
import { generateInvoiceAction } from '@/lib/zatca/actions';
import { supabaseAdmin } from '@/lib/supabase';
import { OdooClient } from '@/lib/odoo/client';
import { generateInvoicePDF } from '@/lib/zatca/pdf/generator';

/**
 * POST /api/odoo/webhook
 *
 * Odoo Integration Webhook.
 * Authenticates using `x-api-key`.
 *
 * Request body:
 * 1. Push Mode (Full Payload):
 * {
 *   "action": "push",
 *   "type": "standard" | "simplified",
 *   "documentType": "388" | "381" | "383",
 *   "invoiceId": "INV-1234",
 *   "buyer": { ... },
 *   "items": [ ... ],
 *   "originalInvoiceId": "INV-1233",
 *   "creditReason": "Return"
 * }
 *
 * 2. Pull & Writeback Mode (Odoo ID only):
 * {
 *   "action": "pull",
 *   "odooInvoiceId": 12
 * }
 */
export async function POST(req: NextRequest) {
    // Check both header and URL query parameters for the API key
    const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('apiKey');
    
    if (!apiKey) {
        return NextResponse.json({ error: 'Missing API Key (header x-api-key or ?apiKey=)' }, { status: 401 });
    }

    // 1. Authenticate Organization
    const organization = await AuthService.validateAPIKey(apiKey) as any;
    if (!organization) {
        return NextResponse.json({ error: 'Invalid or revoked API Key' }, { status: 401 });
    }

    try {
        const body = await req.json();
        
        // Auto-detect Odoo native webhook payload
        const action = body.action || (body._model === 'account.move' ? 'pull' : 'push');

        // ==========================================
        // FLOW A: PUSH MODE (Full Payload)
        // ==========================================
        if (action === 'push') {
            const isStandard = body.type === 'standard';
            if (!body.type || !body.invoiceId || !body.items?.length || (isStandard && !body.buyer)) {
                return NextResponse.json({
                    error: `Missing required fields: type, invoiceId, items ${isStandard ? ', buyer' : ''}`
                }, { status: 400 });
            }

            // 1. Process invoice through core ZATCA logic
            const result = await generateInvoiceAction(body, organization.id);

            // 2. Log transaction
            await supabaseAdmin.from('transaction_logs').insert({
                organization_id: organization.id,
                request_type: body.type === 'simplified' ? 'reporting' : 'clearance',
                invoice_number: body.invoiceId,
                invoice_hash: result.success ? (result.data?.hash || result.data?.uuid) : null,
                status: result.success ? 'success' : 'failure',
                response_payload: { ...result, body }
            });

            // 3. Persist invoice to dashboard
            if (result.success && result.data) {
                const invoiceStatus = result.data.status === 'CLEARED' ? 'cleared' : 
                                      result.data.status === 'REPORTED' ? 'reported' : 'cleared';
                const items = body.items || [];
                const subtotal = items.reduce((acc: number, item: any) => acc + (item.quantity * item.unitPrice), 0);
                const vatTotal = items.reduce((acc: number, item: any) => acc + (item.quantity * item.unitPrice * (item.vatRate || 15) / 100), 0);

                await supabaseAdmin.from('invoices').upsert({
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
            }

            if (!result.success) {
                return NextResponse.json({
                    success: false,
                    error: result.error,
                    validationMessages: result.validationMessages || []
                }, { status: 422 });
            }

            const data = result.data!;
            return NextResponse.json({
                success: true,
                invoiceId: data.id,
                uuid: data.uuid,
                zatcaStatus: data.status,
                documentType: body.documentType || '388',
                documentTypeLabel:
                    body.documentType === '381' ? 'Credit Note' :
                    body.documentType === '383' ? 'Debit Note' :
                    'Tax Invoice',
                invoiceType: body.type,
                originalInvoiceId: body.originalInvoiceId || null,
                validationMessages: data.validationMessages ?? [],
                qrCode: data.qrCode,
                invoiceHash: data.hash,
                signedXml: Buffer.from(data.xml).toString('base64'),
                timestamp: new Date().toISOString()
            });
        }

        // ==========================================
        // FLOW B: PULL & WRITEBACK MODE
        // ==========================================
        if (action === 'pull') {
            // Support both custom python script payload AND native Odoo webhook payload
            const odooInvoiceId = body.odooInvoiceId || body._id;
            
            if (!odooInvoiceId) {
                return NextResponse.json({ error: 'Missing odooInvoiceId or _id for pull action' }, { status: 400 });
            }

            // 1. Fetch Odoo Connection settings from the database
            const { data: config, error: configError } = await supabaseAdmin

                .from('odoo_config')
                .select('*')
                .eq('organization_id', organization.id)
                .maybeSingle();

            if (configError || !config) {
                return NextResponse.json({
                    error: 'Odoo integration is not configured. Please complete setup in the dashboard.'
                }, { status: 400 });
            }

            // 2. Initialize Odoo Client
            const odoo = new OdooClient({
                odooUrl: config.odoo_url,
                odooDb: config.odoo_db,
                odooUsername: config.odoo_username,
                odooPassword: config.odoo_password
            });

            // 3. Fetch invoice details from Odoo
            let odooInvoice;
            try {
                odooInvoice = await odoo.getInvoice(Number(odooInvoiceId));
            } catch (err: any) {
                return NextResponse.json({
                    error: `Failed to fetch invoice from Odoo: ${err.message}`
                }, { status: 422 });
            }

            // 4. Submit invoice to ZATCA
            const result = await generateInvoiceAction(odooInvoice, organization.id);

            // Log results
            await supabaseAdmin.from('transaction_logs').insert({
                organization_id: organization.id,
                request_type: odooInvoice.type === 'simplified' ? 'reporting' : 'clearance',
                invoice_number: odooInvoice.invoiceId,
                invoice_hash: result.success ? (result.data?.hash || result.data?.uuid) : null,
                status: result.success ? 'success' : 'failure',
                response_payload: { ...result, body: odooInvoice }
            });

            // Persist to dashboard
            if (result.success && result.data) {
                const invoiceStatus = result.data.status === 'CLEARED' ? 'cleared' : 
                                      result.data.status === 'REPORTED' ? 'reported' : 'cleared';
                const items = odooInvoice.items || [];
                const subtotal = items.reduce((acc: number, item: any) => acc + (item.quantity * item.unitPrice), 0);
                const vatTotal = items.reduce((acc: number, item: any) => acc + (item.quantity * item.unitPrice * (item.vatRate || 15) / 100), 0);

                await supabaseAdmin.from('invoices').upsert({
                    organization_id: organization.id,
                    invoice_number: odooInvoice.invoiceId,
                    invoice_type: odooInvoice.type,
                    document_type: odooInvoice.documentType || '388',
                    status: invoiceStatus,
                    total_amount: subtotal + vatTotal,
                    zatca_status: result.data.status,
                    zatca_uuid: result.data.uuid,
                    qr_code: result.data.qrCode,
                    xml: result.data.xml,
                    payload: {
                        ...odooInvoice,
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
            }

            // 5. Write back results to Odoo
            try {
                if (result.success && result.data) {
                    // Generate PDF compliance report with embedded QR code
                    let pdfBase64: string | undefined;
                    try {
                        const pdfBuffer = await generateInvoicePDF({
                            invoice: {
                                invoice_number: odooInvoice.invoiceId,
                                invoice_type: odooInvoice.type,
                                status: (result.data.status === 'CLEARED' || result.data.status === 'REPORTED') ? 'cleared' : 'submitted',
                                created_at: new Date().toISOString(),
                                payload: {
                                    ...odooInvoice,
                                    seller: result.data.seller,
                                    items: odooInvoice.items || [],
                                }
                            },
                            qrCode: result.data.qrCode,
                            hash: result.data.hash
                        });
                        pdfBase64 = pdfBuffer.toString('base64');
                    } catch (pdfErr: any) {
                        console.error(`[Webhook PDF Gen Error] Invoice ID ${odooInvoiceId}:`, pdfErr.message);
                    }

                    const xmlBase64 = result.data.xml ? Buffer.from(result.data.xml).toString('base64') : undefined;

                    await odoo.writebackStatus(Number(odooInvoiceId), {
                        status: (result.data.status === 'CLEARED' || result.data.status === 'REPORTED') ? 'cleared' : 'submitted',
                        uuid: result.data.uuid,
                        qrCode: result.data.qrCode,
                        xml: result.data.xml,
                        pdfBase64,
                        xmlBase64,
                        documentType: odooInvoice.documentType,
                        originalInvoiceId: odooInvoice.originalInvoiceId
                    });
                } else {
                    await odoo.writebackStatus(Number(odooInvoiceId), {
                        status: 'failed',
                        error: result.error || 'ZATCA Clearance failed'
                    });
                }
            } catch (writeError: any) {
                console.error(`[Odoo Writeback Error] Invoice ID ${odooInvoiceId}:`, writeError.message);
                // Return success anyway, since ZATCA cleared it, but note the writeback failure
                return NextResponse.json({
                    success: result.success,
                    uuid: result.data?.uuid,
                    zatcaStatus: result.data?.status,
                    writebackSuccess: false,
                    writebackError: writeError.message,
                    validationMessages: result.data?.validationMessages || []
                });
            }

            if (!result.success) {
                return NextResponse.json({
                    success: false,
                    error: result.error,
                    validationMessages: result.validationMessages || []
                }, { status: 422 });
            }

            const data = result.data!;
            return NextResponse.json({
                success: true,
                invoiceId: data.id,
                uuid: data.uuid,
                zatcaStatus: data.status,
                documentType: odooInvoice.documentType,
                documentTypeLabel:
                    odooInvoice.documentType === '381' ? 'Credit Note' :
                    odooInvoice.documentType === '383' ? 'Debit Note' :
                    'Tax Invoice',
                invoiceType: odooInvoice.type,
                originalInvoiceId: odooInvoice.originalInvoiceId || null,
                writebackSuccess: true,
                validationMessages: data.validationMessages ?? [],
                qrCode: data.qrCode,
                invoiceHash: data.hash,
                timestamp: new Date().toISOString()
            });
        }

        return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
