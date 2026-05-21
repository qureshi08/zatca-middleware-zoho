const { jsPDF } = require('jspdf');
const fs = require('fs');
const path = require('path');

// Mock data based on route.ts usage
const odooInvoice = {
    invoiceId: 'INV/2026/00001',
    type: 'simplified',
    items: [
        { name: 'Consulting', quantity: 2, unitPrice: 100, vatRate: 15 }
    ]
};

const resultData = {
    status: 'CLEARED',
    qrCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    hash: 'JYnLSWYEF0VUg1TYFA+tER7y8G5l1QvLQwHnf26sDao=',
    seller: {
        partyLegalEntity: { registrationName: 'Test Seller Ltd' },
        partyTaxScheme: { companyID: '300000000000003' }
    }
};

async function test() {
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
        const p = odooInvoice;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.text('TAX INVOICE', m, 25);

        if (resultData.qrCode) {
            let qrImage = resultData.qrCode;
            doc.addImage(qrImage, 'PNG', 150, 45, 45, 45);
        }

        const buf1 = Buffer.from(doc.output('arraybuffer'));
        const buf2 = Buffer.from(doc.output(), 'binary');

        console.log('buf1 (arraybuffer) length:', buf1.length);
        console.log('buf2 (binary string) length:', buf2.length);
        console.log('Buffers equal:', buf1.equals(buf2));

        fs.writeFileSync(path.join(__dirname, 'test_arraybuffer_img.pdf'), buf1);
        fs.writeFileSync(path.join(__dirname, 'test_binary_img.pdf'), buf2);

    } catch (e) {
        console.error('ERROR during generation:', e);
    }
}

test();
