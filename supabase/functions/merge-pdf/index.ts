import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { summaryBase64, asaasUrl, energyBillUrl } = await req.json()

    if (!summaryBase64 || !asaasUrl) {
      throw new Error('summaryBase64 e asaasUrl são obrigatórios')
    }

    // 1. Carregar o PDF do Demonstrativo (enviado pelo frontend em Base64)
    const cleanBase64 = summaryBase64.includes(',') ? summaryBase64.split(',')[1] : summaryBase64
    const summaryBytes = Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0))
    const summaryDoc = await PDFDocument.load(summaryBytes)

    // 2. Buscar o PDF do Boleto no Asaas
    console.log(`Buscando boleto em: ${asaasUrl}`)
    const asaasRes = await fetch(asaasUrl)
    if (!asaasRes.ok) throw new Error(`Erro ao buscar boleto no Asaas: ${asaasRes.statusText}`)
    const asaasBytes = await asaasRes.arrayBuffer()
    const asaasDoc = await PDFDocument.load(asaasBytes)

    // 3. Buscar o PDF da Conta de Energia (opcional)
    let energyBillDoc = null
    if (energyBillUrl) {
      console.log(`Buscando conta de energia em: ${energyBillUrl}`)
      try {
        const energyRes = await fetch(energyBillUrl)
        if (energyRes.ok) {
          const energyBytes = await energyRes.arrayBuffer()
          // Verificação rápida se o PDF é válido
          if (energyBytes.byteLength > 0) {
              try {
                  energyBillDoc = await PDFDocument.load(energyBytes)
                  console.log(`Conta de energia carregada com sucesso (${energyBillDoc.getPageCount()} páginas)`)
      } catch (loadErr: any) {
        console.error('Erro ao carregar PDF da conta (provavelmente PDF corrompido ou protegido):', loadErr.message)
      }
    }
  } else {
    console.error(`Erro ao buscar conta de energia. Status: ${energyRes.status} ${energyRes.statusText}`)
  }
} catch (e: any) {
  console.error('Erro de rede ao buscar conta de energia:', e.message)
}
}

// 4. Criar Novo PDF e Mesclar
const mergedPdf = await PDFDocument.create()

// Copiar páginas do Demonstrativo
const summaryPages = await mergedPdf.copyPages(summaryDoc, summaryDoc.getPageIndices())
summaryPages.forEach(p => mergedPdf.addPage(p))

// Copiar páginas do Boleto Asaas
const asaasPages = await mergedPdf.copyPages(asaasDoc, asaasDoc.getPageIndices())
asaasPages.forEach(p => mergedPdf.addPage(p))

// Copiar páginas da Conta de Energia (se existir e for válida)
if (energyBillDoc) {
try {
  const energyPages = await mergedPdf.copyPages(energyBillDoc, energyBillDoc.getPageIndices())
  energyPages.forEach(p => mergedPdf.addPage(p))
} catch (copyErr: any) {
  console.error('Erro ao copiar páginas da conta para o PDF final:', copyErr.message)
}
}

const mergedBytes = await mergedPdf.save()

return new Response(mergedBytes, {
headers: {
  ...corsHeaders,
  'Content-Type': 'application/pdf',
  'Content-Disposition': 'attachment; filename="fatura_consolidada.pdf"'
}
})

} catch (err: any) {
console.error('Erro na Edge Function merge-pdf:', err)
return new Response(JSON.stringify({ error: err.message }), {
status: 400,
headers: { ...corsHeaders, 'Content-Type': 'application/json' }
})
}
})
