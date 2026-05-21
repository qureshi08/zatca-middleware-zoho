const fs = require('fs');
const path = require('path');

try {
    const file = fs.readFileSync(path.join(__dirname, 'test_generator.pdf'));
    const content = file.toString('binary');
    console.log('File length:', file.length);
    console.log('Starts with %PDF:', content.startsWith('%PDF'));
    console.log('Ends with %%EOF:', content.trim().endsWith('%%EOF') || content.includes('%%EOF'));
    console.log('Last 50 bytes:', JSON.stringify(content.substring(content.length - 50)));
} catch (e) {
    console.error(e);
}
