// Helper para converter valores numéricos
const parseValue = (raw) => {
    if (!raw) return 0;
    if (raw.includes(',') && raw.includes('.')) return parseFloat(raw.replace(/\./g, '').replace(',', '.'));
    if (raw.includes(',')) return parseFloat(raw.replace(',', '.'));
    return parseFloat(raw);
};

// Parser central de faturas da Neoenergia Cosern (usando pdfjs)
export const parseEnergyBill = async (pdfFile, targetUcNumber = null) => {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) {
        throw new Error("pdfjsLib não está disponível no window.");
    }

    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdfDocument = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    let stampCoords = null;
    
    for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const textContent = await page.getTextContent();
        
        // Find coordinates for the stamp on the first page
        if (i === 1) {
            const targetItem = textContent.items.find(item => 
                item.str.toUpperCase().includes('INFORMAÇÕES IMPORTANTES') || 
                item.str.toUpperCase().includes('AVISOS')
            );
            if (targetItem) {
                stampCoords = { x: targetItem.transform[4], y: targetItem.transform[5] };
            }
        }

        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + ' ';
    }

    // Neoenergia Patterns
    const cleanText = fullText.replace(/\s+/g, ' '); // normalize spaces
    console.log("PDF TEXT (DEBUG):", cleanText);

    const ucMatch = cleanText.match(/(?:Conta Contrato|C[óo]digo do Cliente|Instala[çc][ãa]o)[:\s]*(\d{9,11})/i) ||
                    cleanText.match(/N[úu]mero da \w+[:\s]*(\d{9,11})/i) ||
                    cleanText.match(/(\d{10})/); // Fallback to any 10 digit number

    // Month Format: REF:MÊS/ANO 03/2026 or Mês de Referência 03/2026
    const explicitRefMatch = cleanText.match(/(?:REF[:\s]*M[EÊ]S.*?ANO|M[eê]s(?:\s*de)?\s*Refer[eê]ncia)[^\d]*(0[1-9]|1[0-2])\/(20\d{2})/i) ||
                             cleanText.match(/(?:REF[:\s]*M[EÊ]S.*?ANO|M[eê]s(?:\s*de)?\s*Refer[eê]ncia)[^\w]*([A-Z]{3}\/\d{4})/i);
    const refMonthMatch = explicitRefMatch || cleanText.match(/(0[1-9]|1[0-2])\/(20[2-9]\d)/); // Strict fallback format

    const dueDateMatch = cleanText.match(/Vencimento.*?\s(\d{2}\/\d{2}\/\d{2,4})/i) || cleanText.match(/VENCIMENTO.*?\b(\d{2}\/\d{2}\/\d{2,4})\b/i);
    const totalAmountMatch = cleanText.match(/(?:TOTAL A PAGAR R\$|Total\s*a\s*Pagar|Valor\s*a\s*Pagar|TOTAL)[^\d]+?([\d.]+(?:,\d{2}))/i) ||
                             cleanText.match(/R\$\s*([\d.]+(?:,\d{2}))/i);
    
    // Consumo (Ativa) TE -> Format 'Consumo-TE kWh 3.230,00'
    const consumptionMatch = cleanText.match(/Consumo-TE.*?kWh\s*([\d.]+(?:,\d+)?)/i) || 
                             cleanText.match(/(?:Energia Ativa.*?TE|TE\s*-\s*Energia|Consumo.*?TE|Energia Ativa).*?(?:kWh|\s)\s*([\d.]+(?:,\d+)?)/i);
    
    // Consumo Compensado -> Format 'G2Comp.oUC-nM-TE kWh 3.230,00-'
    const compensadoMatch = cleanText.match(/Comp.*?oUC.*?(?:TE|TUSD).*?kWh\s*([\d.]+(?:,\d+)?)/i) ||
                            cleanText.match(/(?:Energia.*?Compensada|Compensada).*?(?:kWh|\s)\s*([\d.]+(?:,\d+)?)/i);

    // CIP -> Format 'Ilum. Púb. Municipal 360,58'
    const cipMatch = cleanText.match(/(?:Ilum\.?\s*P[uú]b\.?\s*Municipal|CONTR\.? ILUM\.? PUB\.?|COSIP|CIP-MUNICIP\.)[^\d]*([\d.]+(?:,\d{2}))/i);

    // Outros Lancamentos (Multas, Juros, etc) - Support for Multa-NF, Juros-NF
    const multasMatch = cleanText.match(/(?:Multa|Juros|Multa-NF|Juros-NF|Mora|Atualiza[çc][ãa]o Monet[áa]ria|Encargos)[^\d]*?(?:\d+\b)?\s*([\d.]+,[\d]{2})/gi);
    let somaOutros = 0;
    if (multasMatch) {
        multasMatch.forEach(m => {
            const valMatch = m.match(/([\d.]+,[\d]{2})$/) || m.match(/([\d.]+,[\d]{2})/);
            if (valMatch) {
                const val = parseValue(valMatch[1]);
                somaOutros += val;
            }
        });
    }

    const parsedUc = ucMatch ? ucMatch[1] : '';
    const isUcMatch = targetUcNumber ? parsedUc === targetUcNumber : true;

    let extractedMesRef = '';
    if (explicitRefMatch) {
        extractedMesRef = `${explicitRefMatch[1]}/${explicitRefMatch[2]}`;
    } else if (refMonthMatch) {
        extractedMesRef = refMonthMatch[0];
    }

    if (extractedMesRef && extractedMesRef.includes('/')) {
        // normalize e.g. 03/2026 or MAR/2026
        const parts = extractedMesRef.split('/');
        const months = { 'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12' };
        let mm = parts[0].toUpperCase();
        mm = months[mm] || mm.padStart(2, '0');
        const yyyy = parts[1].length === 2 ? `20${parts[1]}` : parts[1];
        extractedMesRef = `${mm}/${yyyy}`;
    }

    let extractedDueDate = '';
    if (dueDateMatch) {
        const parts = dueDateMatch[1].split('/');
        const yyyy = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        extractedDueDate = `${yyyy}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    }

    let extractedReadDate = '';
    const readDateMatch = cleanText.match(/(?:Data\s+da\s+Leitura|Leitura\s+Atual|Apresentada\s+em|Emissão|Pr[oó]xima\s+Leitura)[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i) ||
                          cleanText.match(/Leit\.\s*Atual\s*(\d{2}\/\d{2}\/\d{2,4})/i) ||
                          cleanText.match(/(?:Leitura\s*atual|Data\s*da\s*Leitura)[:\s]*(\d{2}\/\d{2})/i);
    if (readDateMatch) {
        const parts = readDateMatch[1].split('/');
        const yyyy = parts.length === 3 ? (parts[2].length === 2 ? `20${parts[2]}` : parts[2]) : (new Date().getFullYear());
        extractedReadDate = `${yyyy}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    }

    // Linha digitável (Barcode) e Pix
    const textNoSpace = cleanText.replace(/[\s\.\-]/g, '');
    const barcodeMatch48 = textNoSpace.match(/8\d{47}/);
    const barcodeMatch47 = textNoSpace.match(/\d{47}/);
    
    const regexLinhaDigitavel = cleanText.match(/(\d{11}\s?\-\s?\d\s\d{11}\s?\-\s?\d\s\d{11}\s?\-\s?\d\s\d{11}\s?\-\s?\d|\d{5}[\s.]?\d{5}[\s.]?\d{5}[\s.]?\d{5}[\s.]?\d{5}[\s.]?\d{5}[\s.]?\d{1}[\s.]?\d{14}|\d{44,48})/);
    const regexPix = cleanText.match(/(000201[\w\d]{30,})/);

    let linhaDigitavelText = '';
    if (barcodeMatch48) {
        linhaDigitavelText = barcodeMatch48[0];
    } else if (barcodeMatch47) {
        linhaDigitavelText = barcodeMatch47[0];
    } else if (regexLinhaDigitavel) {
        linhaDigitavelText = regexLinhaDigitavel[1].replace(/[\s.-]/g, '');
    }

    const pixStringText = regexPix ? regexPix[1] : '';

    // Consumo Compensado - Regra: Somar apenas lançamentos -TE
    const compensadoMatches = cleanText.match(/G\dComp\..*?\-TE\s+kWh\s+([\d,.]+)-/gi);
    let totalCompensado = 0;
    if (compensadoMatches) {
        compensadoMatches.forEach(match => {
            const valMatch = match.match(/([\d,.]+)-/);
            if (valMatch) totalCompensado += parseValue(valMatch[1]);
        });
    } else {
        totalCompensado = parseValue(compensadoMatch ? compensadoMatch[1] : 0);
    }

    // Energia Ativa Injetada
    let parsedEnergiaInjetada = 0;
    const parseConsumption = (raw) => {
        if (!raw) return 0;
        let cleaned = raw.trim();
        if (cleaned.includes(',')) {
            cleaned = cleaned.split(',')[0];
        }
        cleaned = cleaned.replace(/\D/g, '');
        const parsed = parseInt(cleaned, 10);
        return isNaN(parsed) ? 0 : parsed;
    };

    const injetadaMatch = cleanText.match(/Energia\s+Ativa\s+Injetada\s+(?:[A-Za-zÀ-ÖØ-öø-ÿ]+\s+)?([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i);
    if (injetadaMatch) {
        parsedEnergiaInjetada = parseConsumption(injetadaMatch[4]);
    } else {
        const fallbackInjetada = cleanText.match(/Energia\s+Ativa\s+Injetada[\s\S]{1,50}?([\d.,]+)/i);
        if (fallbackInjetada) {
            const idxOf = cleanText.indexOf(fallbackInjetada[0]);
            const context = cleanText.substring(idxOf, idxOf + 150);
            const allNumbers = context.match(/[\d.,]+/g);
            if (allNumbers && allNumbers.length >= 4) {
                parsedEnergiaInjetada = parseConsumption(allNumbers[3]);
            } else if (allNumbers && allNumbers.length > 0) {
                parsedEnergiaInjetada = parseConsumption(allNumbers[allNumbers.length - 1]);
            }
        }
    }

    const parsedConsumo = parseValue(consumptionMatch ? consumptionMatch[1] : 0);
    const parsedCompensado = totalCompensado;

    return {
        codigoCliente: parsedUc,
        mesReferencia: extractedMesRef,
        vencimento: extractedDueDate,
        dataLeitura: extractedReadDate,
        valorTotal: parseValue(totalAmountMatch ? totalAmountMatch[1] : null) || 0,
        consumoKwh: parseInt(parsedConsumo) || 0,
        consumoCompensado: parseInt(parsedCompensado) || 0,
        energiaInjetada: parsedEnergiaInjetada || 0,
        cipValor: parseValue(cipMatch ? cipMatch[1] : 0) || 0,
        outrosLancamentos: somaOutros,
        linhaDigitavel: linhaDigitavelText,
        pixString: pixStringText,
        stampCoords: stampCoords,
        isUcMatch: isUcMatch
    };
};
