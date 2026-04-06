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

    const mergedPdf = await PDFDocument.create()
    const cleanBase64 = summaryBase64.includes(',') ? summaryBase64.split(',')[1] : summaryBase64
    const summaryBytes = Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0))

    // 1. Detectar e processar o Demonstrativo
    const isPdf = cleanBase64.startsWith('JVBERi0')
    if (isPdf) {
      console.log('Merge: Processando demonstrativo como PDF')
      const summaryDoc = await PDFDocument.load(summaryBytes)
      const summaryPages = await mergedPdf.copyPages(summaryDoc, summaryDoc.getPageIndices())
      summaryPages.forEach(p => mergedPdf.addPage(p))
    } else {
      console.log('Merge: Processando demonstrativo como Imagem')
      try {
        let summaryImg;
        try {
          summaryImg = await mergedPdf.embedPng(summaryBytes)
        } catch (e) {
          summaryImg = await mergedPdf.embedJpg(summaryBytes)
        }
        const page = mergedPdf.addPage([summaryImg.width, summaryImg.height])
        page.drawImage(summaryImg, { x: 0, y: 0, width: summaryImg.width, height: summaryImg.height })
      } catch (imgErr: any) {
        throw new Error(`Falha ao converter imagem do demonstrativo: ${imgErr.message}`)
      }
    }

    // 2. Buscar o PDF do Boleto no Asaas com RETRY (Asaas as vezes demora a gerar o PDF)
    console.log(`Buscando boleto Asaas em: ${asaasUrl}`)
    let asaasRes;
    let retries = 3;
    while (retries > 0) {
        asaasRes = await fetch(asaasUrl)
        if (asaasRes.ok) break;
        
        console.warn(`Tentativa de buscar boleto falhou (${asaasRes.status}). Retentando em 2s... Restam ${retries-1}`)
        await new Promise(r => setTimeout(r, 2000))
        retries--;
    }

    if (!asaasRes || !asaasRes.ok) {
        throw new Error(`Erro ao buscar boleto no Asaas após várias tentativas (${asaasRes?.status || 'network_error'})`)
    }
    
    const asaasBytes = await asaasRes.arrayBuffer()
    const asaasDoc = await PDFDocument.load(asaasBytes)

    // 3. Buscar o PDF da Conta de Energia (opcional)
    if (energyBillUrl) {
      console.log(`Buscando conta de energia em: ${energyBillUrl}`)
      try {
        const energyRes = await fetch(energyBillUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (CRM-B2W-PDF-Merger)' }
        })
        if (energyRes.ok) {
          const energyBytes = await energyRes.arrayBuffer()
          if (energyBytes.byteLength > 0) {
              const energyBillDoc = await PDFDocument.load(energyBytes)
              const energyPages = await mergedPdf.copyPages(energyBillDoc, energyBillDoc.getPageIndices())
              energyPages.forEach(p => mergedPdf.addPage(p))
              console.log('Conta de energia mesclada com sucesso')
          }
        }
      } catch (e: any) {
        console.error('Erro ao processar conta de energia (pulando):', e.message)
      }
    }

    // 4. Finalizar merge
    const asaasPages = await mergedPdf.copyPages(asaasDoc, asaasDoc.getPageIndices())
    asaasPages.forEach(p => mergedPdf.addPage(p))

    const mergedBytes = await mergedPdf.save()

    return new Response(mergedBytes, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
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
