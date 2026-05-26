const fs = require('fs');
const path = require('path');

// Let's import pdfjs-dist
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const files = [
    'candidate_1_1777410484486.pdf',
    'candidate_2_1777414327446.pdf',
    'candidate_3_1777414570289.pdf'
];

async function extractText(filePath) {
    const data = new Uint8Array(fs.readFileSync(filePath));
    const loadingTask = pdfjs.getDocument({ data });
    const pdf = await loadingTask.promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const textItems = textContent.items.map(item => item.str).join(' ');
        fullText += `\n--- Page ${i} ---\n` + textItems;
    }
    return fullText;
}

async function run() {
    for (const file of files) {
        const filePath = path.join(__dirname, file);
        console.log(`\n=========================================`);
        console.log(`Extracting from ${file}...`);
        try {
            const text = await extractText(filePath);
            
            // Let's search for typical patterns:
            // "Referência: MM/AAAA" or "Mês de Referência"
            // Let's print out lines containing "ref" or "vencimento" or date patterns
            console.log(`Successfully extracted ${text.length} chars.`);
            
            // Let's find some key indicators in the text:
            const refMatches = text.match(/(?:referencia|mês|vencimento|total|pagar|R\$|\d{2}\/\d{4})/gi) || [];
            console.log(`Found matches count: ${refMatches.length}`);
            
            // Let's print the first 1000 characters of the text
            console.log(`Sample Text:`);
            console.log(text.substring(0, 1500));
        } catch (e) {
            console.error(`Error reading ${file}:`, e.message);
        }
    }
}

run();
