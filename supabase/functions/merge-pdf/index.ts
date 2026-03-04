import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { summaryBase64, asaasUrl } = await req.json()

    if (!summaryBase64 || !asaasUrl) {
      throw new Error('summaryBase64 e asaasUrl são obrigatórios')
    }

    // 1. Carregar o PDF do Demonstrativo (enviado pelo frontend em Base64)
    // Remove o prefixo se existir: data:application/pdf;base64,
    const cleanBase64 = summaryBase64.includes(',') ? summaryBase64.split(',')[1] : summaryBase64
    const summaryBytes = Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0))
    const summaryDoc = await PDFDocument.load(summaryBytes)

    // 2. Buscar o PDF do Boleto no Asaas
    console.log(`Buscando boleto em: ${asaasUrl}`)
    const asaasRes = await fetch(asaasUrl)
    if (!asaasRes.ok) throw new Error(`Erro ao buscar boleto no Asaas: ${asaasRes.statusText}`)

    const asaasBytes = await asaasRes.arrayBuffer()
    const asaasDoc = await PDFDocument.load(asaasBytes)

    // 3. Criar Novo PDF e Mesclar
    const mergedPdf = await PDFDocument.create()

    const summaryPages = await mergedPdf.copyPages(summaryDoc, summaryDoc.getPageIndices())
    summaryPages.forEach(p => mergedPdf.addPage(p))

    const asaasPages = await mergedPdf.copyPages(asaasDoc, asaasDoc.getPageIndices())
    asaasPages.forEach(p => mergedPdf.addPage(p))

    const mergedBytes = await mergedPdf.save()

    return new Response(mergedBytes, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="fatura_consolidada.pdf"'
      }
    })

  } catch (err) {
    console.error('Erro na Edge Function merge-pdf:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
