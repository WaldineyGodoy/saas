const fs = require('fs');
const pdfParse = require('pdf-parse');

console.log("pdfParse type:", typeof pdfParse);
console.log("pdfParse keys:", Object.keys(pdfParse));

let dataBuffer = fs.readFileSync('C:\\Users\\Godoy\\Documents\\HTML\\WorkSpace 1 Antigravity\\Faturas\\007022090989 (3).pdf');

if (typeof pdfParse === 'function') {
    pdfParse(dataBuffer).then(function(data) {
        console.log("Matches:", data.text.replace(/\s+/g, ' ').match(/.{0,50}Parc.{0,50}/gi));
    }).catch(console.error);
} else if (pdfParse && typeof pdfParse.default === 'function') {
    pdfParse.default(dataBuffer).then(function(data) {
        console.log("Matches:", data.text.replace(/\s+/g, ' ').match(/.{0,50}Parc.{0,50}/gi));
    }).catch(console.error);
}
