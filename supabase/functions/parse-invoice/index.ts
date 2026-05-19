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

    // Padrões de Extração (Regex)
    const consumptionMatch = fullText.match(/(?:Energia Ativa|Consumo Total|Total Consumo)[^\d]*(\d+)[^\d]*kWh/i) || 
                             fullText.match(/kWh[^\d]*(\d+)/i) ||
                             fullText.match(/(\d+)\s*kWh/i);
    
    const cipMatch = fullText.match(/(?:CONTR\.? ILUM\.? PUB\.?|COSIP|CIP-MUNICIP\.|Ilum\.?\s*P[uú]bl\.?\s*Municipal|Ilum\.?\s*P[uú]bl\.?)[^\d]*([\d,.]+)/i);

    const refMonthMatch = fullText.match(/M[êe]s\s*Refer[êe]ncia[:\s]*(\w{3}\/\d{2,4})|REF\.?\s*M[ÊE]S\/ANO[\s\n]*(\d{2}\/\d{4})|REF[:\s]*(\w{3}\/\d{2,4})/i);
    const dueDateMatch = fullText.match(/Vencimento[:\s\n]*(\d{2}\/\d{2}\/\d{2,4})/i);
    const totalAmountMatch = fullText.match(/TOTAL\s+A\s+PAGAR[\s\n]*(?:R\$)?[\s\n]*([\d,.]+)/i) || fullText.match(/Valor\s*a\s*Pagar[:\s]*R\$?\s*([\d,.]+)/i);
    const readingDateMatch = fullText.match(/(?:Leitura\s*Atual|Data\s*da\s*Leitura)[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i);
    const othersMatch = fullText.match(/(?:Outros\s*Lançamentos|Adicionais)[:\s]*R\$?\s*([\d,.]+)/i);

    const parseValue = (raw: string | null) => {
        if (!raw) return 0;
        if (raw.includes(',') && raw.includes('.')) return parseFloat(raw.replace(/\./g, '').replace(',', '.'));
        if (raw.includes(',')) return parseFloat(raw.replace(',', '.'));
        return parseFloat(raw);
    };

    // Consumo Reais (Soma TUSD e TE ou Valores Genéricos)
    let consumo_reais = 0;
    const extractLastNumber = (line: string) => {
        const matches = line.match(/([\d,.]+)/g);
        return matches ? parseValue(matches[matches.length - 1]) : 0;
    };
    const tusdLine = fullText.match(/Consumo-TUSD[^\n]*/i);
    const teLine = fullText.match(/Consumo-TE[^\n]*/i);
    if (tusdLine && teLine) {
        consumo_reais = extractLastNumber(tusdLine[0]) + extractLastNumber(teLine[0]);
    } else {
        const energiaAtivaReais = fullText.match(/Energia Ativa[^\n]*/i);
        if (energiaAtivaReais) {
            consumo_reais = extractLastNumber(energiaAtivaReais[0]);
        }
    }

    // Linha Digitável
    let linha_digitavel = null;
    const barcodeCandidates = fullText.match(/(?:\d[\s\.\-]*){40,55}/g);
    if (barcodeCandidates) {
        for (const candidate of barcodeCandidates) {
            const clean = candidate.replace(/\D/g, '');
            if (clean.length === 44 || clean.length === 47 || clean.length === 48) {
                // Ignore NFe Keys (starts with state code, usually 44 digits)
                if (clean.length === 44 && !clean.startsWith('8')) continue;
                linha_digitavel = clean;
                break;
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
        consumo_kwh: consumptionMatch ? parseInt(consumptionMatch[1].replace(/\D/g, '')) : 0,
        consumo_reais: consumo_reais,
        iluminacao_publica: parseValue(cipMatch ? cipMatch[1] : null),
        mes_referencia: parseMesRef(refMonthMatch ? (refMonthMatch[1] || refMonthMatch[2] || refMonthMatch[3]) : null),
        vencimento: formatDate(dueDateMatch ? dueDateMatch[1] : null),
        valor_a_pagar: parseValue(totalAmountMatch ? (totalAmountMatch[1] || totalAmountMatch[2]) : null),
        data_leitura: formatDate(readingDateMatch ? readingDateMatch[1] : null),
        outros_lancamentos: parseValue(othersMatch ? othersMatch[1] : null),
        linha_digitavel: linha_digitavel
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
