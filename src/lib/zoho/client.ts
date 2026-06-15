// ZOHO BOOKS REST CLIENT (Z3C v10.0)
// Communicates with Zoho Books over its v3 REST API using OAuth2 (refresh-token grant).
//
// Unlike Odoo's JSON-RPC + database-level field provisioning, Zoho Books is a hosted SaaS:
//  - Authentication is OAuth2. We exchange a long-lived refresh token for a short-lived
//    access token on demand.
//  - Data lives behind region-specific API hosts (.sa for KSA, .com for US, .eu, .in, ...).
//  - Customer-side documents are split into two entities: `invoices` (388) and
//    `creditnotes` (381). Zoho Books has no native customer debit note, so 383 is only
//    produced when an explicit custom-field override says so.
//  - Write-back happens through comments + file attachments (always available) and,
//    optionally, custom fields if the org has created them in Zoho.

export interface ZohoConfig {
    zohoRegion: string;        // Data-center suffix: 'sa' | 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca'
    zohoOrgId: string;         // Zoho Books organization_id
    zohoClientId: string;      // OAuth2 client id (Self Client / Server-based app)
    zohoClientSecret?: string; // OAuth2 client secret
    zohoRefreshToken?: string; // OAuth2 refresh token
}

export type ZohoEntityType = 'invoice' | 'creditnote';

export class ZohoClient {
    private region: string;
    private orgId: string;
    private clientId: string;
    private clientSecret?: string;
    private refreshToken?: string;
    private accessToken: string | null = null;

    constructor(config: ZohoConfig) {
        this.region = (config.zohoRegion || 'sa').replace(/^\./, '').trim();
        this.orgId = config.zohoOrgId;
        this.clientId = config.zohoClientId;
        this.clientSecret = config.zohoClientSecret;
        this.refreshToken = config.zohoRefreshToken;
    }

    /** Accounts (OAuth) host for the configured data center. */
    private get accountsHost(): string {
        // Canada lives on a separate cloud domain; everything else is accounts.zoho.<region>.
        if (this.region === 'ca') return 'https://accounts.zohocloud.ca';
        return `https://accounts.zoho.${this.region}`;
    }

    /** Books API host for the configured data center. */
    private get apiHost(): string {
        if (this.region === 'ca') return 'https://www.zohoapis.ca';
        return `https://www.zohoapis.${this.region}`;
    }

    /** True when the config is a local/offline simulation rather than a live tenant. */
    private get isMock(): boolean {
        return (
            this.clientId === 'mock' ||
            this.refreshToken === 'mock' ||
            this.orgId === 'mock' ||
            this.clientSecret === 'mock'
        );
    }

    /**
     * Exchanges the refresh token for a short-lived access token.
     * Cached for the lifetime of this client instance (one request cycle).
     */
    private async getAccessToken(): Promise<string> {
        if (this.accessToken) return this.accessToken;
        if (this.isMock) {
            this.accessToken = 'mock-access-token';
            return this.accessToken;
        }

        if (!this.refreshToken || !this.clientId || !this.clientSecret) {
            throw new Error('Zoho client id, client secret and refresh token are required for authentication.');
        }

        const params = new URLSearchParams({
            refresh_token: this.refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'refresh_token',
        });

        const res = await fetch(`${this.accountsHost}/oauth/v2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            cache: 'no-store',
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.access_token) {
            const detail = json.error || `${res.status} ${res.statusText}`;
            throw new Error(`Zoho OAuth token refresh failed: ${detail}`);
        }

        this.accessToken = json.access_token as string;
        return this.accessToken;
    }

    /**
     * Performs an authenticated REST call against the Zoho Books v3 API.
     * `path` is everything after `/books/v3` (e.g. `/invoices/123`).
     */
    private async request(
        method: string,
        path: string,
        options: { query?: Record<string, string>; jsonBody?: any } = {}
    ): Promise<any> {
        const token = await this.getAccessToken();

        const query = new URLSearchParams({ organization_id: this.orgId, ...(options.query || {}) });
        const url = `${this.apiHost}/books/v3${path}?${query.toString()}`;

        const headers: Record<string, string> = {
            Authorization: `Zoho-oauthtoken ${token}`,
        };

        let body: string | undefined;
        if (options.jsonBody !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(options.jsonBody);
        }

        const res = await fetch(url, { method, headers, body, cache: 'no-store' });
        const json = await res.json().catch(() => ({}));

        // Zoho returns code === 0 on success in its envelope.
        if (!res.ok || (typeof json.code === 'number' && json.code !== 0)) {
            const message = json.message || `${res.status} ${res.statusText}`;
            throw new Error(`Zoho Books API error (${method} ${path}): ${message}`);
        }

        return json;
    }

    /**
     * Verifies the credentials by fetching the configured organization profile.
     */
    async testConnection(): Promise<{ success: boolean; orgName?: string; error?: string }> {
        if (this.isMock) {
            return { success: true, orgName: 'Mock Organization (Simulation)' };
        }
        try {
            await this.getAccessToken();
            const json = await this.request('GET', `/organizations/${this.orgId}`);
            const orgName = json?.organization?.name || 'Connected';
            return { success: true, orgName };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Lists the custom fields configured on a Zoho Books module so the operator can
     * confirm the ZATCA write-back fields exist. Zoho does not allow reliable custom
     * field *creation* through the public API, so this is verification-only — fields
     * must be created once in Zoho Books › Settings › Preferences › <Module> › Field
     * Customization. We look for the recommended `cf_zatca_*` set.
     */
    async provisionCustomFields(): Promise<{ success: boolean; created: string[]; errors: string[] }> {
        const recommended = [
            'cf_zatca_uuid',
            'cf_zatca_status',
            'cf_zatca_qr_code',
            'cf_zatca_error',
        ];

        if (this.isMock) {
            return { success: true, created: recommended.map((f) => `${f} (simulated)`), errors: [] };
        }

        try {
            await this.getAccessToken();
            // Pull the custom fields registered on the invoice module.
            let existing: string[] = [];
            try {
                const json = await this.request('GET', '/settings/fields', { query: { entity: 'invoice' } });
                const fields = json?.fields || json?.customfields || [];
                existing = fields
                    .map((f: any) => (f.api_name || f.field_name_formatted || f.label || '').toLowerCase())
                    .filter(Boolean);
            } catch {
                // Settings endpoint varies by plan; fall through to guidance below.
            }

            const created: string[] = [];
            const errors: string[] = [];
            for (const f of recommended) {
                if (existing.some((e) => e.includes(f.replace('cf_', '')))) {
                    created.push(`${f} (exists)`);
                } else {
                    errors.push(`${f} (missing — create it under invoice Field Customization)`);
                }
            }

            return { success: errors.length === 0, created, errors };
        } catch (e: any) {
            return { success: false, created: [], errors: [e.message] };
        }
    }

    /** Resolves the VAT/Tax registration number from a Zoho contact record. */
    private static extractVat(contact: any): string {
        if (!contact) return '';
        if (contact.tax_reg_no) return contact.tax_reg_no;
        // KSA edition sometimes stores it under custom fields.
        const cf = (contact.custom_fields || []).find((c: any) =>
            (c.api_name || c.label || '').toLowerCase().includes('vat') ||
            (c.api_name || c.label || '').toLowerCase().includes('tax_reg')
        );
        return cf?.value || '';
    }

    /**
     * Pulls an invoice (or credit note) from Zoho Books and maps it to the
     * SimpleInvoiceInput shape consumed by the ZATCA core engine.
     */
    async getInvoice(documentId: string, entityType: ZohoEntityType = 'invoice'): Promise<any> {
        if (this.isMock) {
            return this.mockInvoice(documentId, entityType);
        }

        const isCreditNote = entityType === 'creditnote';
        const resourcePath = isCreditNote ? `/creditnotes/${documentId}` : `/invoices/${documentId}`;
        const envelopeKey = isCreditNote ? 'creditnote' : 'invoice';

        const json = await this.request('GET', resourcePath);
        const doc = json[envelopeKey];
        if (!doc) {
            throw new Error(`${entityType} ${documentId} not found in Zoho Books.`);
        }

        // Fetch the full contact for VAT number + address (the document only embeds a summary).
        let contact: any = {};
        if (doc.customer_id) {
            try {
                const contactJson = await this.request('GET', `/contacts/${doc.customer_id}`);
                contact = contactJson?.contact || {};
            } catch (e: any) {
                console.warn('[Zoho] Failed to fetch contact details:', e.message);
            }
        }

        const billing = contact.billing_address || doc.billing_address || {};
        const vat = ZohoClient.extractVat(contact);
        const countryCode = billing.country_code || (billing.country === 'Saudi Arabia' ? 'SA' : 'SA');

        // Map line items.
        const items = [];
        for (const line of doc.line_items || []) {
            const quantity = Number(line.quantity) || 0;
            if (quantity <= 0) continue;
            items.push({
                name: line.name || line.description || 'Sales Item',
                quantity,
                unitPrice: Number(line.rate) || 0,
                vatCategory: 'S',
                vatRate: typeof line.tax_percentage === 'number' ? line.tax_percentage : 15,
            });
        }

        // B2B (standard, requires clearance) vs B2C (simplified, reporting only).
        const isB2B = !!vat;
        const type = isB2B ? 'standard' : 'simplified';

        // Document type: credit notes are 381, invoices are 388. A `cf_zatca_document_type`
        // custom field can override (e.g. force 383 debit note).
        let documentType = isCreditNote ? '381' : '388';
        // Zoho Books KSA exposes Debit Notes as an invoice subtype via the `type`
        // field (e.g. "debit_note") rather than a separate module, so a regular
        // invoice pull may actually be a debit note (383).
        if (!isCreditNote && typeof doc.type === 'string' && doc.type.toLowerCase().includes('debit')) {
            documentType = '383';
        }
        const override = (doc.custom_fields || []).find((c: any) =>
            (c.api_name || c.label || '').toLowerCase().includes('zatca_document_type')
        );
        if (override?.value) {
            documentType = String(override.value);
        }

        const isAdjustment = documentType === '381' || documentType === '383';

        const docNumber = isCreditNote
            ? (doc.creditnote_number || `CN-${documentId}`)
            : (doc.invoice_number || `INV-${documentId}`);

        // Original invoice reference for credit/debit notes — REQUIRED by ZATCA
        // (rendered as cac:BillingReference/InvoiceDocumentReference in the UBL).
        //
        // The source field differs by document kind:
        //  - Credit note: Zoho KSA links the corrected invoice at the header level
        //    (`invoice_number` / `invoice_id`). `invoices_credited` only fills once the
        //    credit is *applied* as payment, so it is a last resort, not the primary.
        //  - Debit note (an invoice subtype): `invoice_number` is the note's OWN number,
        //    so the original is referenced via `reference_number`.
        let originalInvoiceId = '';
        if (isAdjustment) {
            if (isCreditNote) {
                const appliedNo = Array.isArray(doc.invoices_credited) && doc.invoices_credited[0]
                    ? (doc.invoices_credited[0].invoice_number || doc.invoices_credited[0].invoice_id)
                    : '';
                originalInvoiceId = doc.invoice_number || appliedNo || doc.reference_number || '';
            } else {
                // Debit notes: the invoice-as-debit-note approach types the number into
                // `reference_number`; native Zoho debit notes leave that empty and expose
                // the linked invoice under the `reference_invoice` object instead.
                originalInvoiceId =
                    doc.reference_number ||
                    doc.reference_invoice?.reference_invoice_number ||
                    '';
            }

            // Last resort: resolve an internal reference invoice id -> human number.
            if (!originalInvoiceId && doc.reference_invoice?.reference_invoice_id) {
                originalInvoiceId = await this.resolveInvoiceNumber(doc.reference_invoice.reference_invoice_id);
            }

            // Never fabricate a reference: a ZATCA adjustment without the real original
            // invoice is non-compliant, so fail loudly instead of emitting a fake one.
            if (!originalInvoiceId) {
                const label = documentType === '381' ? 'credit note' : 'debit note';
                throw new Error(
                    `This ${label} (${docNumber}) has no linked original invoice. ZATCA requires a billing ` +
                    `reference for adjustment documents — associate it with the original invoice in Zoho before validating.`
                );
            }
        }

        return {
            type,
            documentType,
            invoiceId: docNumber,
            buyer: {
                partyIdentification: { id: vat || 'UNREGISTERED', schemeID: vat ? 'TXID' : 'NAT' },
                postalAddress: {
                    streetName: billing.address || 'Street Address',
                    buildingNumber: '1000',
                    citySubdivisionName: billing.city || 'Riyadh',
                    cityName: billing.city || 'Riyadh',
                    postalZone: billing.zip || '11564',
                    country: countryCode,
                },
                partyTaxScheme: { companyID: vat || '' },
                partyLegalEntity: { registrationName: doc.customer_name || contact.contact_name || 'Walk-in Customer' },
                name: doc.customer_name || contact.contact_name || 'Walk-in Customer',
                vatNumber: vat || '',
                street: billing.address || 'Street Address',
                building: '1000',
                city: billing.city || 'Riyadh',
                postalCode: billing.zip || '11564',
                country: countryCode,
            },
            items,
            zohoRaw: doc,
            zohoEntityType: entityType,
            ...(isAdjustment && {
                originalInvoiceId,
                creditReason: doc.reason || doc.reference_number || 'Adjustment Note',
            }),
        };
    }

    /**
     * Writes ZATCA compliance results back to the Zoho Books document:
     *  - posts a status comment to the document timeline (always),
     *  - attaches the compliance PDF (when available),
     *  - best-effort updates `cf_zatca_*` custom fields if they exist.
     */
    async writebackStatus(
        documentId: string,
        data: {
            status: 'cleared' | 'failed' | 'submitted';
            uuid?: string;
            qrCode?: string;
            xml?: string;
            error?: string;
            pdfBase64?: string;
            documentType?: string;
            originalInvoiceId?: string;
            entityType?: ZohoEntityType;
        }
    ): Promise<boolean> {
        const entityType = data.entityType || 'invoice';
        const isCreditNote = entityType === 'creditnote';
        const base = isCreditNote ? `/creditnotes/${documentId}` : `/invoices/${documentId}`;

        if (this.isMock) {
            console.log(`[Zoho] (mock) writeback ${data.status} for ${entityType} ${documentId}`);
            return true;
        }

        const docTypeLabel =
            data.documentType === '381' ? 'Credit Note (381)' :
            data.documentType === '383' ? 'Debit Note (383)' :
            'Tax Invoice (388)';
        const linkedLine = data.originalInvoiceId ? ` | Linked original: ${data.originalInvoiceId}` : '';
        const comment =
            data.status === 'cleared' || data.status === 'submitted'
                ? `ZATCA Compliance: ${docTypeLabel} ${data.status === 'cleared' ? 'Cleared' : 'Reported'} successfully. UUID: ${data.uuid}${linkedLine}. Signed XML and compliance PDF attached.`
                : `ZATCA Compliance: Submission Failed. Error: ${data.error}`;

        // 1. Best-effort custom field write-back (only succeeds if fields exist in Zoho).
        try {
            await this.request('PUT', base, {
                jsonBody: {
                    custom_fields: [
                        { api_name: 'cf_zatca_uuid', value: data.uuid || '' },
                        { api_name: 'cf_zatca_status', value: data.status },
                        { api_name: 'cf_zatca_qr_code', value: data.qrCode || '' },
                        { api_name: 'cf_zatca_error', value: data.error || '' },
                    ],
                },
            });
        } catch (e: any) {
            console.warn('[Zoho] Custom field write-back skipped:', e.message);
        }

        // 2. Post a comment to the document timeline (always available).
        try {
            await this.request('POST', `${base}/comments`, {
                jsonBody: { description: comment },
            });
        } catch (e: any) {
            console.warn('[Zoho] Failed to post comment:', e.message);
        }

        // 3. Remove any prior ZATCA_* attachments so re-validation replaces rather
        //    than stacks duplicates, then attach the compliance PDF (QR embedded).
        if ((data.status === 'cleared' || data.status === 'submitted') && (data.pdfBase64 || data.qrCode)) {
            await this.deleteExistingZatcaAttachments(base, isCreditNote ? 'creditnote' : 'invoice');
        }
        // 4. Attach the QR PNG FIRST so it's viewable, then the PDF LAST. The last
        //    upload becomes the invoice's primary `attachment_name`, which is the file
        //    Zoho includes when the document is emailed — so the customer gets the
        //    ZATCA-verified PDF automatically, no manual selection.
        if ((data.status === 'cleared' || data.status === 'submitted') && data.qrCode) {
            const m = data.qrCode.match(/^data:image\/png;base64,(.+)$/);
            if (m) {
                try {
                    await this.uploadAttachment(base, `ZATCA_QR_${documentId}.png`, m[1], 'image/png');
                } catch (e: any) {
                    console.warn('[Zoho] Failed to attach QR image:', e.message);
                }
            }
        }
        if ((data.status === 'cleared' || data.status === 'submitted') && data.pdfBase64) {
            try {
                await this.uploadAttachment(base, `ZATCA_${documentId}.pdf`, data.pdfBase64, 'application/pdf', true);
            } catch (e: any) {
                console.warn('[Zoho] Failed to attach PDF:', e.message);
            }
        }

        return true;
    }

    /** Resolves a Zoho invoice internal id to its human-readable invoice number. */
    private async resolveInvoiceNumber(invoiceId: string): Promise<string> {
        try {
            const json = await this.request('GET', `/invoices/${invoiceId}`);
            return json?.invoice?.invoice_number || '';
        } catch {
            return '';
        }
    }

    /**
     * Deletes any previously attached ZATCA_* files on a document so a re-run
     * replaces them instead of accumulating duplicates.
     */
    private async deleteExistingZatcaAttachments(basePath: string, envelopeKey: string): Promise<void> {
        try {
            const json = await this.request('GET', basePath);
            const docs = json?.[envelopeKey]?.documents || [];
            for (const d of docs) {
                if (typeof d.file_name === 'string' && d.file_name.startsWith('ZATCA_') && d.document_id) {
                    try {
                        await this.request('DELETE', `${basePath}/documents/${d.document_id}`);
                    } catch (e: any) {
                        console.warn('[Zoho] Failed to delete old attachment:', e.message);
                    }
                }
            }
        } catch (e: any) {
            console.warn('[Zoho] Could not list existing attachments for cleanup:', e.message);
        }
    }

    /**
     * Uploads a base64 file as a multipart attachment to a Zoho Books document.
     * When `sendInMail` is true, Zoho includes the file automatically whenever the
     * document is emailed to the customer (the ZATCA-verified PDF rides along).
     */
    private async uploadAttachment(
        basePath: string,
        filename: string,
        base64: string,
        mimeType: string,
        sendInMail = false
    ): Promise<void> {
        const token = await this.getAccessToken();
        const query = new URLSearchParams({ organization_id: this.orgId });
        if (sendInMail) query.set('can_send_in_mail', 'true');
        const url = `${this.apiHost}/books/v3${basePath}/attachment?${query.toString()}`;

        const bytes = Buffer.from(base64, 'base64');
        const blob = new Blob([bytes], { type: mimeType });
        const form = new FormData();
        form.append('attachment', blob, filename);

        const res = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Zoho-oauthtoken ${token}` },
            body: form,
            cache: 'no-store',
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || (typeof json.code === 'number' && json.code !== 0)) {
            throw new Error(json.message || `${res.status} ${res.statusText}`);
        }
    }

    /** Offline simulation payload mirroring the live mapping shape. */
    private mockInvoice(documentId: string, entityType: ZohoEntityType) {
        const isCreditNote = entityType === 'creditnote';
        return {
            type: 'standard',
            documentType: isCreditNote ? '381' : '388',
            invoiceId: isCreditNote ? `CN-${documentId}` : `INV-${documentId}`,
            buyer: {
                partyIdentification: { id: '300000000000003', schemeID: 'TXID' },
                postalAddress: {
                    streetName: 'King Fahd Road',
                    buildingNumber: '1000',
                    citySubdivisionName: 'Al Olaya',
                    cityName: 'Riyadh',
                    postalZone: '11564',
                    country: 'SA',
                },
                partyTaxScheme: { companyID: '300000000000003' },
                partyLegalEntity: { registrationName: 'Mock Buyer Co.' },
                name: 'Mock Buyer Co.',
                vatNumber: '300000000000003',
                street: 'King Fahd Road',
                building: '1000',
                city: 'Riyadh',
                postalCode: '11564',
                country: 'SA',
            },
            items: [
                { name: 'Consulting Services', quantity: 1, unitPrice: 1000, vatCategory: 'S', vatRate: 15 },
            ],
            zohoRaw: { id: documentId },
            zohoEntityType: entityType,
            ...(isCreditNote && { originalInvoiceId: 'INV-000001', creditReason: 'Return' }),
        };
    }
}
