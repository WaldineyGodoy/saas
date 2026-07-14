import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse/index.js'); // CommonJS load 

let dataBuffer = fs.readFileSync('C:\\Users\\Godoy\\Documents\\HTML\\WorkSpace 1 Antigravity\\Faturas\\007022090989 (3).pdf');

pdf(dataBuffer).then(function(data) {
    const text = data.text;
    const cleanText = text.replace(/\s+/g, ' ');
    console.log("Matches:", cleanText.match(/.{0,50}Parc.{0,50}/gi));
}).catch(console.error);
