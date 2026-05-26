import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const files = [
    'candidate_guanabara.pdf',
    'candidate_7029875787.pdf'
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
            console.log(`Successfully extracted ${text.length} chars.`);
            console.log(`Sample Text (first 1500 chars):`);
            console.log(text.substring(0, 1500));
        } catch (e) {
            console.error(`Error reading ${file}:`, e.message);
        }
    }
}

run();
