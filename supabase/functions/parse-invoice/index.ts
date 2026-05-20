import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { pdfBase64, pdfUrl } = await req.json()
    let pdfBuffer: ArrayBuffer

    if (pdfBase64) {
      const cleanBase64 = pdfBase64.includes(',') ? pdfBase64.split(',')[1] : pdfBase64
      const binaryString = atob(cleanBase64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      pdfBuffer = bytes.buffer
    } else if (pdfUrl) {
      const res = await fetch(pdfUrl)
      if (!res.ok) throw new Error(`Falha ao buscar PDF na URL: ${res.statusText}`)
      pdfBuffer = await res.arrayBuffer()
    } else {
      throw new Error('pdfBase64 ou pdfUrl é obrigatório')
    }

    // Usando unpdf via esm.sh na versão 1.6.2, injetando manualmente o pdfjs bundle
    // para evitar o erro de dynamic import "PDF.js is not available" nas Edge Functions do Supabase.
    const unpdfModule = await import("https://esm.sh/unpdf@1.6.2");
    const pdfjsModule = await import("https://esm.sh/unpdf@1.6.2/dist/pdfjs.mjs");

    const configureUnPDF = unpdfModule.configureUnPDF || unpdfModule.default?.configureUnPDF;
    if (configureUnPDF) {
      await configureUnPDF({
        pdfjs: async () => pdfjsModule
      });
    }

    const getDocumentProxy = unpdfModule.getDocumentProxy || unpdfModule.default?.getDocumentProxy;
    const extractText = unpdfModule.extractText || unpdfModule.default?.extractText;

    if (!getDocumentProxy || !extractText) {
      throw new Error("Não foi possível carregar as funções de extração de PDF do pacote 'unpdf'. Verifique a versão.");
    }
    
    const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
    const { text } = await extractText(pdf);
    const fullText = Array.isArray(text) ? text.join("\n") : (text || "");

    const parseValue = (raw: string | null) => {
        if (!raw) return 0;
        let val = raw;
        if (val.includes(',') && val.includes('.')) val = val.replace(/\./g, '').replace(',', '.');
        else if (val.includes(',')) val = val.replace(',', '.');
        const parsed = parseFloat(val);
        return isNaN(parsed) ? 0 : parsed;
    };

    const parseConsumption = (raw: string | null) => {
        if (!raw) return 0;
        let cleaned = raw.trim();
        if (cleaned.includes(',')) {
            cleaned = cleaned.split(',')[0];
        }
        cleaned = cleaned.replace(/\D/g, '');
        const parsed = parseInt(cleaned, 10);
        return isNaN(parsed) ? 0 : parsed;
    };

    // Padrões de Extração (Regex)
    const consumptionMatch = fullText.match(/(?:Energia Ativa|Consumo Total|Total Consumo)[^\d]*([\d.,]+)[^\d]*kWh/i) || 
                             fullText.match(/kWh[^\d]*([\d.,]+)/i) ||
                             fullText.match(/([\d.,]+)\s*kWh/i);
    
    // Iluminação Pública: Regex a prova de balas para lidar com quebras de linha ou espaçamentos malucos
    let iluminacao_publica = 0;
    const cipMatch = fullText.match(/(?:Ilum[\s\S]{0,30}Municipal|Ilumina[çc][ãa]o[\s\S]{0,10}P[úu]blica|COSIP|CIP-MUNICIP)[\s\S]{0,40}?(\d{1,4},\d{2})/i);
    if (cipMatch) {
        iluminacao_publica = parseValue(cipMatch[1]);
    }

    // Mês Referência: REF.MÊS/ANO 04/2026
    const refMonthMatch = fullText.match(/(?:REF\.?M[EÊ]S\/ANO|M[EÊ]S\s*REFER[EÊ]NCIA|REF)[^\d]*(\d{2}\/\d{2,4})/i) || 
                          fullText.match(/(\d{2}\/\d{4})/); // Fallback: primeiro MM/YYYY

    const dueDateMatch = fullText.match(/Vencimento[^\d]*(\d{2}\/\d{2}\/\d{2,4})/i);
    
    // Total a Pagar: Pega a última ocorrência da palavra TOTAL seguida de um valor (geralmente é o valor final no rodapé)
    let valor_a_pagar = 0;
    const totalAmountMatches = [...fullText.matchAll(/TOTAL[\s\S]{0,100}?(\d{1,5},\d{2})/gi)];
    if (totalAmountMatches.length > 0) {
        valor_a_pagar = parseValue(totalAmountMatches[totalAmountMatches.length - 1][1]);
    } else {
        const fallbackMatch = fullText.match(/Valor\s*a\s*Pagar[^\d]*([\d,.]+)/i);
        if (fallbackMatch) valor_a_pagar = parseValue(fallbackMatch[1]);
    }
    
    const prevReadingMatch = fullText.match(/Leitura\s*Anterior[^\d]*(\d{2}\/\d{2}\/\d{2,4})/i);
    const readingDateMatch = fullText.match(/(?:Leitura\s*Atual|Data\s*da\s*Leitura)[^\d]*(\d{2}\/\d{2}\/\d{2,4})/i);
    
    // Energia Ativa Injetada
    let energia_injetada = 0;
    const injetadaLineMatch = fullText.match(/Energia\s+Ativa\s+Injetada[^\n]*/i);
    if (injetadaLineMatch) {
        const lineText = injetadaLineMatch[0];
        const fourNumbersMatch = lineText.match(/([\d.,]+)[^\d]+([\d.,]+)[^\d]+([\d.,]+)[^\d]+([\d.,]+)/);
        if (fourNumbersMatch) {
            energia_injetada = parseConsumption(fourNumbersMatch[4]);
        } else {
            const allNumbers = lineText.match(/[\d.,]+/g);
            if (allNumbers && allNumbers.length > 0) {
                energia_injetada = parseConsumption(allNumbers[allNumbers.length - 1]);
            }
        }
    }

    // Saldo atualizado de créditos (kWh)
    let saldo_kwh = 0;
    const saldoMatch = fullText.match(/Saldo\s+atualizado\s+de\s+cr[eé]ditos\s*=\s*([\d.,]+)/i);
    if (saldoMatch) {
        saldo_kwh = parseConsumption(saldoMatch[1]);
    }

    // Outros Lançamentos (Multas, Juros, Parcelamentos)
    let outros_lancamentos = 0;
    const othersRegex = /(?:Juros[\s\S]{0,15}Mora|Multa[\s\S]{0,15}Atraso|Atualiza[çc][ãa]o[\s\S]{0,15}Monet[áa]ria|Parc\d*\/\d*[\s\S]{0,20}|Parcelamento[\s\S]{0,20})[\s\S]{0,40}?(\d{1,4},\d{2})/gi;
    const othersMatches = [...fullText.matchAll(othersRegex)];
    for (const match of othersMatches) {
        outros_lancamentos += parseValue(match[1]);
    }

    // Consumo Reais: Pega especificamente o VALOR (R$) que é a 3ª coluna de números após "kWh"
    // Ex: Consumo-TUSD kWh 753,00 0,57337503 431,75
    let consumo_reais = 0;
    
    const tusdMatch = fullText.match(/Consumo-TUSD\s*kWh\s*[\d,.]+\s+[\d,.]+\s+([\d,.]+)/i);
    const teMatch = fullText.match(/Consumo-TE\s*kWh\s*[\d,.]+\s+[\d,.]+\s+([\d,.]+)/i);
    
    if (tusdMatch && teMatch) {
        consumo_reais = parseValue(tusdMatch[1]) + parseValue(teMatch[1]);
    } else {
        // Fallback genérico para a linha "Energia Ativa" (tentar pegar o 3º número)
        const energiaAtivaReais = fullText.match(/Energia Ativa[^\n]*/i);
        if (energiaAtivaReais) {
            const matches = energiaAtivaReais[0].match(/([\d,.]+)/g);
            if (matches && matches.length >= 3) {
                // Tenta pegar o 3º número (depois da quantidade e preço unitário)
                consumo_reais = parseValue(matches[2]);
            } else if (matches) {
                consumo_reais = parseValue(matches[matches.length - 1]);
            }
        }
    }
       // Linha Digitável: Estratégia imbatível -> Limpar todos os espaços do documento inteiro e procurar a sequência de 44 a 48 dígitos que começa com '8' (Padrão Arrecadação)
    let linha_digitavel = null;
    const allNumbersText = fullText.replace(/[\s\.\-\n\r\t_]/g, '');
    const utilityBarcodeMatch = allNumbersText.match(/8\d{43,47}/);
    if (utilityBarcodeMatch) {
        linha_digitavel = utilityBarcodeMatch[0];
    } else {
        // Fallback antigo
        const barcodeCandidates = fullText.match(/(?:\d[\s\.\-]*){40,55}/g);
        if (barcodeCandidates) {
            for (const candidate of barcodeCandidates) {
                const clean = candidate.replace(/\D/g, '');
                if (clean.length >= 44 && clean.length <= 48) {
                    if (clean.length === 44 && !clean.startsWith('8')) continue;
                    linha_digitavel = clean;
                    break;
                }
            }
        }
    }

    const formatDate = (raw: string | null) => {
        if (!raw) return null;
        const parts = raw.split('/');
        if (parts.length < 2) return null;
        const year = parts[2]?.length === 2 ? `20${parts[2]}` : parts[2];
        return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    };

    const months: Record<string, string> = {
        'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06',
        'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12'
    };

    const parseMesRef = (raw: string | null) => {
        if (!raw) return null;
        const parts = raw.split('/');
        if (parts.length !== 2) return null;
        const month = months[parts[0].toUpperCase()] || parts[0].padStart(2, '0');
        const year = parts[1].length === 2 ? `20${parts[1]}` : parts[1];
        return `${year}-${month}`;
    };

    const result = {
        consumo_kwh: consumptionMatch ? parseConsumption(consumptionMatch[1]) : 0,
        consumo_reais: consumo_reais,
        iluminacao_publica: iluminacao_publica,
        mes_referencia: parseMesRef(refMonthMatch ? refMonthMatch[1] : null),
        vencimento: formatDate(dueDateMatch ? dueDateMatch[1] : null),
        valor_a_pagar: valor_a_pagar,
        data_leitura_anterior: formatDate(prevReadingMatch ? prevReadingMatch[1] : null),
        data_leitura: formatDate(readingDateMatch ? readingDateMatch[1] : null),
        outros_lancamentos: outros_lancamentos,
        linha_digitavel: linha_digitavel,
        energia_injetada: energia_injetada,
        saldo_kwh: saldo_kwh
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Erro na Edge Function parse-invoice:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
