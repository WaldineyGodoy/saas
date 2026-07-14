const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/index.css';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('hide-number-spin')) {
    content += `

/* Hide arrows in number inputs for power calculation fields */
.hide-number-spin::-webkit-inner-spin-button,
.hide-number-spin::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.hide-number-spin {
  -moz-appearance: textfield;
}
`;
    fs.writeFileSync(path, content, 'utf8');
}
console.log('CSS updated');
