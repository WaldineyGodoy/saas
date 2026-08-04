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

    const ucs = [];
    
    // Look for rows that look like: "475551010 1 0,00 GDI"
    // (UC code) (Prioridade/Percentual) (Saldo) (Classificação GD)
    const regex = /(\d{9,11})\s+(\d+[\.,]?\d*)\s+([\d\.,]+)\s+(GDI|GDII|GDIII|MGD|GD)/g;
    const matches = [...fullText.matchAll(regex)];
    
    for (const match of matches) {
      const ucCode = match[1];
      const valStr = match[2].replace(',', '.');
      const prioridadeOuPercentual = parseFloat(valStr);
      
      ucs.push({
        uc: ucCode,
        valor: prioridadeOuPercentual
      });
    }

    return new Response(JSON.stringify({ ucs, rawExtractedRows: matches.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Erro na Edge Function parse-demonstrativo:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
