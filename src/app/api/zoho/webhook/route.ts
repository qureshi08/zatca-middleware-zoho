import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth-service';
import { generateInvoiceAction } from '@/lib/zatca/actions';
import { supabaseAdmin } from '@/lib/supabase';
import { ZohoClient, type ZohoEntityType } from '@/lib/zoho/client';
import { generateInvoicePDF } from '@/lib/zatca/pdf/generator';

/**
 * POST /api/zoho/webhook
 *
 * Zoho Books Integration Webhook.
 * Authenticates using `x-api-key` (header or ?apiKey=).
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
 * 2. Pull & Writeback Mode (Zoho document id only):
 * {
 *   "action": "pull",
 *   "zohoInvoiceId": "460000000012345",
 *   "entityType": "invoice" | "creditnote"   // optional, defaults to invoice
 * }
 */
export async function POST(req: NextRequest) {
    const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('apiKey');

    if (!apiKey) {
        return NextResponse.json({ error: 'Missing API Key (header x-api-key or ?apiKey=)' }, { status: 401 });
    }

    const organization = await AuthService.validateAPIKey(apiKey) as any;
    if (!organization) {
        return NextResponse.json({ error: 'Invalid or revoked API Key' }, { status: 401 });
    }

    try {
        const body = await req.json();

        // Auto-detect action: Zoho native webhooks may post the raw document JSON.
        const inferredId = body.zohoInvoiceId || body.invoice_id || body.creditnote_id;
        const action = body.action || (inferredId ? 'pull' : 'push');

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

            const result = await generateInvoiceAction(body, organization.id);

            await supabaseAdmin.from('transaction_logs').insert({
                organization_id: organization.id,
                request_type: body.type === 'simplified' ? 'reporting' : 'clearance',
                invoice_number: body.invoiceId,
                invoice_hash: result.success ? (result.data?.hash || result.data?.uuid) : null,
                status: result.success ? 'success' : 'failure',
                response_payload: { ...result, body }
            });

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
            const zohoInvoiceId = inferredId;
            const entityType: ZohoEntityType = body.entityType
                || (body.creditnote_id ? 'creditnote' : 'invoice');

            if (!zohoInvoiceId) {
                return NextResponse.json({ error: 'Missing zohoInvoiceId (or invoice_id / creditnote_id) for pull action' }, { status: 400 });
            }

            // 1. Fetch Zoho connection settings from the database
            const { data: config, error: configError } = await supabaseAdmin
                .from('zoho_config')
                .select('*')
                .eq('organization_id', organization.id)
                .maybeSingle();

            if (configError || !config) {
                return NextResponse.json({
                    error: 'Zoho Books integration is not configured. Please complete setup in the dashboard.'
                }, { status: 400 });
            }

            // 2. Initialize Zoho client
            const zoho = new ZohoClient({
                zohoRegion: config.zoho_region,
                zohoOrgId: config.zoho_org_id,
                zohoClientId: config.zoho_client_id,
                zohoClientSecret: config.zoho_client_secret,
                zohoRefreshToken: config.zoho_refresh_token,
            });

            // 3. Fetch document details from Zoho
            let zohoInvoice;
            try {
                zohoInvoice = await zoho.getInvoice(String(zohoInvoiceId), entityType);
            } catch (err: any) {
                return NextResponse.json({
                    error: `Failed to fetch document from Zoho Books: ${err.message}`
                }, { status: 422 });
            }

            // 4. Submit invoice to ZATCA
            const result = await generateInvoiceAction(zohoInvoice, organization.id);

            await supabaseAdmin.from('transaction_logs').insert({
                organization_id: organization.id,
                request_type: zohoInvoice.type === 'simplified' ? 'reporting' : 'clearance',
                invoice_number: zohoInvoice.invoiceId,
                invoice_hash: result.success ? (result.data?.hash || result.data?.uuid) : null,
                status: result.success ? 'success' : 'failure',
                response_payload: { ...result, body: zohoInvoice }
            });

            if (result.success && result.data) {
                const invoiceStatus = result.data.status === 'CLEARED' ? 'cleared' :
                                      result.data.status === 'REPORTED' ? 'reported' : 'cleared';
                const items = zohoInvoice.items || [];
                const subtotal = items.reduce((acc: number, item: any) => acc + (item.quantity * item.unitPrice), 0);
                const vatTotal = items.reduce((acc: number, item: any) => acc + (item.quantity * item.unitPrice * (item.vatRate || 15) / 100), 0);

                await supabaseAdmin.from('invoices').upsert({
                    organization_id: organization.id,
                    invoice_number: zohoInvoice.invoiceId,
                    invoice_type: zohoInvoice.type,
                    document_type: zohoInvoice.documentType || '388',
                    status: invoiceStatus,
                    total_amount: subtotal + vatTotal,
                    zatca_status: result.data.status,
                    zatca_uuid: result.data.uuid,
                    qr_code: result.data.qrCode,
                    xml: result.data.xml,
                    payload: {
                        ...zohoInvoice,
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

            // 5. Write back results to Zoho
            try {
                if (result.success && result.data) {
                    let pdfBase64: string | undefined;
                    try {
                        const pdfBuffer = await generateInvoicePDF({
                            invoice: {
                                invoice_number: zohoInvoice.invoiceId,
                                invoice_type: zohoInvoice.type,
                                status: (result.data.status === 'CLEARED' || result.data.status === 'REPORTED') ? 'cleared' : 'submitted',
                                created_at: new Date().toISOString(),
                                payload: {
                                    ...zohoInvoice,
                                    seller: result.data.seller,
                                    items: zohoInvoice.items || [],
                                }
                            },
                            qrCode: result.data.qrCode,
                            hash: result.data.hash
                        });
                        pdfBase64 = pdfBuffer.toString('base64');
                    } catch (pdfErr: any) {
                        console.error(`[Zoho Webhook PDF Gen Error] Doc ID ${zohoInvoiceId}:`, pdfErr.message);
                    }

                    await zoho.writebackStatus(String(zohoInvoiceId), {
                        status: (result.data.status === 'CLEARED' || result.data.status === 'REPORTED') ? 'cleared' : 'submitted',
                        uuid: result.data.uuid,
                        qrCode: result.data.qrCode,
                        xml: result.data.xml,
                        pdfBase64,
                        documentType: zohoInvoice.documentType,
                        originalInvoiceId: zohoInvoice.originalInvoiceId,
                        entityType,
                    });
                } else {
                    await zoho.writebackStatus(String(zohoInvoiceId), {
                        status: 'failed',
                        error: result.error || 'ZATCA Clearance failed',
                        entityType,
                    });
                }
            } catch (writeError: any) {
                console.error(`[Zoho Writeback Error] Doc ID ${zohoInvoiceId}:`, writeError.message);
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
                documentType: zohoInvoice.documentType,
                documentTypeLabel:
                    zohoInvoice.documentType === '381' ? 'Credit Note' :
                    zohoInvoice.documentType === '383' ? 'Debit Note' :
                    'Tax Invoice',
                invoiceType: zohoInvoice.type,
                originalInvoiceId: zohoInvoice.originalInvoiceId || null,
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
