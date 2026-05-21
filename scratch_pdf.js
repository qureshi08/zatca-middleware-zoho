const { jsPDF } = require('jspdf');
const fs = require('fs');
const path = require('path');

try {
    const doc = new jsPDF();
    doc.text("Hello World", 10, 10);
    const buf1 = Buffer.from(doc.output('arraybuffer'));
    fs.writeFileSync(path.join(__dirname, 'test_arraybuffer.pdf'), buf1);

    const buf2 = Buffer.from(doc.output(), 'binary');
    fs.writeFileSync(path.join(__dirname, 'test_binary.pdf'), buf2);

    const f1 = fs.readFileSync(path.join(__dirname, 'test_arraybuffer.pdf'));
    const f2 = fs.readFileSync(path.join(__dirname, 'test_binary.pdf'));
    console.log('f1 header:', f1.toString('ascii', 0, 8));
    console.log('f2 header:', f2.toString('ascii', 0, 8));
} catch (e) {
    console.error(e);
}
