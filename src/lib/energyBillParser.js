// Helper para converter valores numéricos
const parseValue = (raw) => {
    if (!raw) return 0;
    if (raw.includes(',') && raw.includes('.')) return parseFloat(raw.replace(/\./g, '').replace(',', '.'));
    if (raw.includes(',')) return parseFloat(raw.replace(',', '.'));
    return parseFloat(raw);
};

const MESES = { 'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12' };

// Monta o texto de uma página do pdfjs preservando as quebras de linha.
// As quebras importam para separar nome, documento e as linhas do endereço.
export const textoDosItens = (items) => items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('');

// Compara identificadores de UC ignorando pontuação e zeros à esquerda:
// "1.979.118.032-02" vira "197911803202" e "007030839166" vira "7030839166".
export const normalizarUc = (valor) => String(valor ?? '').replace(/\D/g, '').replace(/^0+/, '');

// A Cosern migrou para o número de UC padrão Aneel. Uma conta pode trazer o
// número novo, o código do cliente antigo ou os dois, e o cadastro pode ter
// qualquer um deles em numero_uc ou numero_uc_anterior.
export const ucConfere = (identificadoresDaConta, identificadoresDoCadastro) => {
    const daConta = identificadoresDaConta.map(normalizarUc).filter(Boolean);
    const doCadastro = identificadoresDoCadastro.map(normalizarUc).filter(Boolean);
    return daConta.some(id => doCadastro.includes(id));
};

const extrairEndereco = (linhasEndereco) => {
    const linhas = linhasEndereco.map(l => l.trim()).filter(Boolean);
    if (linhas.length === 0) return null;

    const endereco = { completo: linhas.join(', '), logradouro: '', complemento: '', bairro: '', cep: '', cidade: '', uf: '' };

    const ultima = linhas[linhas.length - 1].match(/^(\d{5}-\d{3})\s+(.+?)\s+([A-Z]{2})$/);
    let resto = linhas;
    if (ultima) {
        endereco.cep = ultima[1];
        endereco.cidade = ultima[2];
        endereco.uf = ultima[3];
        resto = linhas.slice(0, -1);
    }

    const idxBairro = resto.findIndex(l => /\/\s*AREA\s+(?:URBANA|RURAL)/i.test(l));
    if (idxBairro >= 0) {
        endereco.bairro = resto[idxBairro].split('/')[0].trim();
        resto = resto.filter((_, i) => i !== idxBairro);
    }

    endereco.logradouro = resto[0] || '';
    endereco.complemento = resto.slice(1).join(', ');
    return endereco;
};

// Histórico "CONSUMO FATURADO": linhas "MAI26 166 29". No layout novo os meses
// anteriores à troca de titularidade vêm sem valores e ficam de fora.
const extrairHistorico = (texto) => {
    const inicio = texto.search(/CONSUMO FATURADO/i);
    if (inicio < 0) return [];
    const fim = texto.slice(inicio).search(/MEDIDOR/i);
    const bloco = texto.slice(inicio, fim > 0 ? inicio + fim : inicio + 800);

    const historico = [];
    for (const m of bloco.matchAll(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s?(\d{2})[ \t]+(\d+)[ \t]+(\d+)/gi)) {
        historico.push({ mes: `20${m[2]}-${MESES[m[1].toUpperCase()]}`, kwh: parseInt(m[3], 10), dias: parseInt(m[4], 10) });
    }
    return historico;
};

const ligacaoDoFornecimento = (tipo) => {
    if (/mono/i.test(tipo)) return 'monofasico';
    if (/bif/i.test(tipo)) return 'bifasico';
    if (/trif/i.test(tipo)) return 'trifasico';
    return '';
};

// Deriva os campos calculados a partir dos campos lidos, para a leitura de foto
// (parse-invoice-image) devolver o mesmo formato que a leitura de PDF.
export const completarLeitura = (lido, ucsDoCadastro = null) => {
    const historico = lido.historico || [];
    const comConsumo = historico.filter(h => h.kwh > 0);
    const end = lido.endereco;
    const alvos = (Array.isArray(ucsDoCadastro) ? ucsDoCadastro : [ucsDoCadastro]).filter(Boolean);
    const ids = [lido.numeroUcNovo, lido.codigoCliente, lido.codigoInstalacao];
    return {
        ...lido,
        numeroUc: lido.numeroUcNovo || lido.codigoCliente || lido.codigoInstalacao || '',
        endereco: end ? {
            ...end,
            completo: [end.logradouro, end.complemento, end.bairro, [end.cep, end.cidade, end.uf].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        } : null,
        ligacao: ligacaoDoFornecimento(lido.tipoFornecimento || ''),
        mediaKwh: comConsumo.length ? Math.round(comConsumo.reduce((s, h) => s + h.kwh, 0) / comConsumo.length) : 0,
        isUcMatch: alvos.length > 0 ? ucConfere(ids, alvos) : true,
    };
};

// Só o que serve para cadastrar a UC (vai para leads.conta_lida). Fica de fora
// o que é da fatura do mês: linha digitável, PIX, carimbo, conferência de UC.
const CAMPOS_PEDIDO = [
    'numeroUc', 'numeroUcNovo', 'codigoCliente', 'codigoInstalacao', 'titular', 'documentoTipo', 'documento',
    'endereco', 'classificacao', 'tipoFornecimento', 'ligacao', 'mediaKwh', 'historico', 'mesReferencia',
    'consumoKwh', 'valorTotal', 'concessionaria',
];
export const contaParaPedido = (leitura) => ({
    concessionaria: 'Neoenergia Cosern', // os dois leitores só conhecem a Cosern
    ...Object.fromEntries(CAMPOS_PEDIDO
        .filter(c => leitura?.[c] !== undefined && leitura[c] !== null && leitura[c] !== '')
        .map(c => [c, leitura[c]])),
});

// A conta traz o número colado no logradouro ("AV JOSE PEREIRA DE ARAUJO 209").
// Sem número no fim (ex.: "RO BR 101 4224 CD- BOMBA"), devolve tudo como rua.
export const separarNumero = (logradouro) => {
    const m = String(logradouro || '').trim().match(/^(.*\D)[\s,]+(\d+[A-Z]?)$/);
    return m ? { rua: m[1].trim(), numero: m[2] } : { rua: String(logradouro || '').trim(), numero: '' };
};

// Parser central de faturas da Neoenergia Cosern (usando pdfjs).
// ucsDoCadastro: numero_uc e/ou numero_uc_anterior da UC esperada (string ou array).
export const parseEnergyBill = async (pdfFile, ucsDoCadastro = null) => {
    // Ninguém definia window.pdfjsLib: a leitura de PDF caía sempre aqui.
    // Import dinâmico para os testes (Node) não carregarem o pdfjs do navegador.
    const pdfjsLib = await import('pdfjs-dist');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
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

        fullText += textoDosItens(textContent.items) + '\n';
    }

    return { ...parseEnergyBillText(fullText, ucsDoCadastro), stampCoords };
};

// Extração a partir do texto já lido do PDF. Separada do pdfjs para ser testável.
export const parseEnergyBillText = (fullText, ucsDoCadastro = null) => {
    // Neoenergia Patterns
    const cleanText = fullText.replace(/\s+/g, ' '); // normalize spaces
    const linhasText = fullText.replace(/[ \t]+/g, ' '); // mantém as quebras de linha

    // Identificação da UC. Layout novo (padrão Aneel, 2026): "NÚMERO DA UNIDADE
    // CONSUMIDORA 1.979.118.032-02", e o código antigo vira "CÓDIGO DÉBITO EM CONTA".
    // Layout antigo: "CÓDIGO DA INSTALAÇÃO" + "CÓDIGO DO CLIENTE".
    // Sem fallback para "qualquer número": ele pegava o protocolo de autorização.
    const numeroUcNovoMatch = cleanText.match(/N[ÚU]MERO DA UNIDADE CONSUMIDORA[:\s]*(\d{1,3}(?:\.\d{3})+-\d{2}|\d{11,15})/i);
    const codigoClienteMatch = cleanText.match(/(?:C[ÓO]DIGO DO CLIENTE|C[ÓO]DIGO D[ÉE]BITO EM CONTA|Conta Contrato)[:\s]*(\d{8,12})/i);
    const codigoInstalacaoMatch = cleanText.match(/C[ÓO]DIGO DA INSTALA[ÇC][ÃA]O[:\s]*(\d{5,12})/i);

    const numeroUcNovo = numeroUcNovoMatch ? numeroUcNovoMatch[1] : '';
    const codigoCliente = codigoClienteMatch ? codigoClienteMatch[1] : '';
    const codigoInstalacao = codigoInstalacaoMatch ? codigoInstalacaoMatch[1] : '';

    // Titular, documento e endereço (mesmos rótulos nos dois layouts)
    const titularMatch = linhasText.match(/NOME DO CLIENTE:\s*([^\n]+?)\s*\n/i);
    const documentoMatch = linhasText.match(/NOME DO CLIENTE:[\s\S]*?\b(CPF|CNPJ):\s*([\d.*\/-]+)/i);
    const enderecoMatch = linhasText.match(/ENDERE[ÇC]O:\s*\n([\s\S]*?)\n\s*(?:N[ÚU]MERO DA UNIDADE|C[ÓO]DIGO DA INSTALA|C[ÓO]DIGO DO CLIENTE)/i);
    const classificacaoMatch = cleanText.match(/CLASSIFICA[ÇC][ÃA]O:\s*(.+?)\s+TIPO DE FORNECIMENTO/i);
    const fornecimentoMatch = cleanText.match(/TIPO DE FORNECIMENTO:\s*(.+?)\s+NOME DO CLIENTE/i);

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
    const compensadoMatch = cleanText.match(/G\dComp\.[mo]UC-\w+-(?:TE|TUSD)\s+kWh\s+([\d.]+(?:,\d+)?)/) ||
                            cleanText.match(/Energia compensada total\s*=\s*([\d.]+(?:,\d+)?)/i);

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

    const numeroUc = numeroUcNovo || codigoCliente || codigoInstalacao;
    const alvos = (Array.isArray(ucsDoCadastro) ? ucsDoCadastro : [ucsDoCadastro]).filter(Boolean);
    const isUcMatch = alvos.length > 0 ? ucConfere([numeroUcNovo, codigoCliente, codigoInstalacao], alvos) : true;

    let extractedMesRef = '';
    if (explicitRefMatch) {
        extractedMesRef = `${explicitRefMatch[1]}/${explicitRefMatch[2]}`;
    } else if (refMonthMatch) {
        extractedMesRef = refMonthMatch[0];
    }

    if (extractedMesRef && extractedMesRef.includes('/')) {
        // normalize e.g. 03/2026 or MAR/2026
        const parts = extractedMesRef.split('/');
        let mm = parts[0].toUpperCase();
        mm = MESES[mm] || mm.padStart(2, '0');
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

    const historico = extrairHistorico(linhasText);
    const comConsumo = historico.filter(h => h.kwh > 0);
    const tipoFornecimento = fornecimentoMatch ? fornecimentoMatch[1].trim() : '';

    return {
        numeroUc,
        numeroUcNovo,
        codigoCliente,
        codigoInstalacao,
        titular: titularMatch ? titularMatch[1].trim() : '',
        documentoTipo: documentoMatch ? documentoMatch[1].toUpperCase() : '',
        documento: documentoMatch ? documentoMatch[2] : '',
        endereco: enderecoMatch ? extrairEndereco(enderecoMatch[1].split('\n')) : null,
        classificacao: classificacaoMatch ? classificacaoMatch[1].trim() : '',
        tipoFornecimento,
        ligacao: ligacaoDoFornecimento(tipoFornecimento),
        historico,
        mediaKwh: comConsumo.length ? Math.round(comConsumo.reduce((s, h) => s + h.kwh, 0) / comConsumo.length) : 0,
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
        isUcMatch: isUcMatch
    };
};
