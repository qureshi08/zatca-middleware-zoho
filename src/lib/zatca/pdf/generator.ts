import { jsPDF } from 'jspdf';

/**
 * Z3C MIDDLEWARE: INSTITUTIONAL-GRADE PDF ENGINE (A4)
 * Hardened for Server-Side Production - v4.0
 * 
 * Uses raw PNG byte arrays for image embedding to avoid
 * data-URL parsing failures in Node.js (no DOM).
 */

interface PDFInput {
    invoice: any;
    qrCode: string;
    hash?: string;
}

/**
 * Extract raw PNG bytes from a data URL or base64 string.
 * Returns a Uint8Array that jsPDF can reliably embed server-side.
 */
function extractPngBytes(dataUrlOrBase64: string): Uint8Array | null {
    try {
        let raw = dataUrlOrBase64;
        // Strip data-URL prefix if present
        const commaIdx = raw.indexOf(',');
        if (commaIdx !== -1) {
            raw = raw.substring(commaIdx + 1);
        }
        const buf = Buffer.from(raw, 'base64');
        // Sanity: first 4 bytes of PNG are 0x89 0x50 0x4E 0x47
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
            return new Uint8Array(buf);
        }
        console.warn('[PDF] QR image is not a valid PNG, skipping embed.');
        return null;
    } catch {
        return null;
    }
}

export async function generateInvoicePDF(data: PDFInput): Promise<Buffer> {
    try {
        const doc = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4',
            putOnlyUsedFonts: true
        });

        const m = 18;
        const pw = 210;
        const cw = pw - (m * 2);
        const p = data.invoice.payload || {};

        // --- 1. HEADER ---
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.setTextColor(20, 50, 150);
        const isSimplified = p.type === 'simplified' || data.invoice.invoice_type === 'simplified';
        const docType = p.documentType || data.invoice.document_type || '388';
        const baseLabel =
            docType === '381' ? 'CREDIT NOTE' :
            docType === '383' ? 'DEBIT NOTE' :
            'TAX INVOICE';
        const typeLabel = isSimplified ? `SIMPLIFIED ${baseLabel}` : baseLabel;
        doc.text(typeLabel, m, 25);

        doc.setFontSize(10);
        doc.setTextColor(150);
        doc.setFont('helvetica', 'normal');
        doc.text('Institutional Compliance - ZATCA Phase 2', m, 32);

        // Clearance Badge
        const isClearedOrReported = data.invoice.status === 'cleared' || data.invoice.status === 'reported';
        if (isClearedOrReported) {
            doc.setFillColor(240, 255, 240);
            doc.roundedRect(pw - m - 30, 18, 30, 8, 2, 2, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(50, 150, 50);
            const badge = data.invoice.status === 'cleared' ? 'CLEARED' : 'REPORTED';
            doc.text(badge, pw - m - 15, 23, { align: 'center' });
        }

        // --- 2. IDENTITY BLOCKS ---
        let y = 45;
        doc.setFontSize(10);
        doc.setTextColor(20, 50, 150);
        doc.text('SELLER DETAILS', m, y);
        doc.text('DOCUMENT SUMMARY', m + (cw / 2) + 5, y);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(50);
        doc.text(p.seller?.partyLegalEntity?.registrationName || 'KSA Banking Node', m, y + 6);
        const docNoLabel =
            docType === '381' ? 'Credit Note No' :
            docType === '383' ? 'Debit Note No' :
            'Invoice No';
        doc.text(`${docNoLabel}: ${data.invoice.invoice_number}`, m + (cw / 2) + 5, y + 6);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(`VAT ID: ${p.seller?.partyTaxScheme?.companyID || '300000000000003'}`, m, y + 11);
        doc.text(`Date: ${new Date(data.invoice.created_at).toLocaleString()}`, m + (cw / 2) + 5, y + 11);

        // For credit/debit notes, surface the original invoice this document corrects
        // (the ZATCA billing reference) so it is human-readable, not just in the XML.
        const originalRef = p.originalInvoiceId;
        if ((docType === '381' || docType === '383') && originalRef) {
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(20, 50, 150);
            doc.text(`Original Invoice: ${originalRef}`, m + (cw / 2) + 5, y + 16);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100);
        }

        y += 25;
        doc.setDrawColor(240);
        doc.line(m, y, pw - m, y);
        y += 10;

        doc.setFontSize(10);
        doc.setTextColor(20, 50, 150);
        doc.text('BUYER DETAILS', m, y);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(50);
        doc.text(p.buyer?.partyLegalEntity?.registrationName || 'Account Holder', m, y + 6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(`VAT ID: ${p.buyer?.partyTaxScheme?.companyID || 'UNREGISTERED'}`, m, y + 11);

        // --- 3. QR CODE (Server-Safe: raw PNG bytes) ---
        if (data.qrCode) {
            try {
                const qrSize = 45;
                const qrx = pw - m - qrSize;
                const qry = y - 5;

                const pngBytes = extractPngBytes(data.qrCode);
                if (pngBytes) {
                    // Pass raw Uint8Array with explicit format – reliable in Node.js
                    doc.addImage(pngBytes, 'PNG', qrx, qry, qrSize, qrSize);
                } else {
                    console.warn('[PDF-QR] Skipped QR embed – invalid PNG data.');
                }
            } catch (qrErr) {
                console.warn('[PDF-QR-WARN]: QR failed to render, skipping image.');
            }
        }

        // --- 4. TABLE ---
        y += 35;
        doc.setFillColor(20, 50, 150);
        doc.rect(m, y, cw, 10, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(255);
        doc.text('Description', m + 2, y + 6.5);
        doc.text('VAT%', m + 120, y + 6.5);
        doc.text('Total (Inc. VAT)', pw - m - 2, y + 6.5, { align: 'right' });

        y += 10;
        doc.setTextColor(50);
        doc.setFont('helvetica', 'normal');
        const items = p.items || [];
        items.forEach((item: any) => {
            const total = item.quantity * item.unitPrice * (1 + (item.vatRate / 100));
            doc.text(item.name || 'Financial Service', m + 2, y + 7);
            doc.text(`${item.vatRate}%`, m + 120, y + 7);
            doc.setFont('helvetica', 'bold');
            doc.text(total.toFixed(2), pw - m - 2, y + 7, { align: 'right' });
            y += 10;
        });

        // --- 5. SUMMARY ---
        y += 10;
        const subTotal = items.reduce((acc: number, x: any) => acc + (x.quantity * x.unitPrice), 0);
        const vatTotal = items.reduce((acc: number, x: any) => acc + (x.quantity * x.unitPrice * (x.vatRate / 100)), 0);
        const grand = subTotal + vatTotal;

        doc.setFontSize(14);
        doc.setTextColor(20, 50, 150);
        doc.text('GRAND TOTAL', pw - m - 70, y);
        doc.text(`${grand.toFixed(2)} SAR`, pw - m - 2, y, { align: 'right' });

        // --- 6. FOOTER ---
        doc.setFontSize(7);
        doc.setTextColor(180);
        doc.text(`UUID: ${data.invoice.id} | Hash: ${data.hash || 'N/A'}`, m, 280);
        doc.text('Certified Electronic Invoice (ZATCA Middleware Node)', m, 284);

        // Use binary string output – most reliable for Node.js Buffer conversion
        const binaryStr = doc.output();
        return Buffer.from(binaryStr, 'latin1');
    } catch (fullError: any) {
        console.error('[CRITICAL-PDF-FATAL]:', fullError.message);
        throw new Error(`PDF Reconstruction Failed: ${fullError.message}`);
    }
}
