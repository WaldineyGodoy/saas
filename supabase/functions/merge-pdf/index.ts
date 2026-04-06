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

    // 1. Criar o PDF inicial e embutir o Demonstrativo (Imagem em Base64 enviada pelo frontend)
    const mergedPdf = await PDFDocument.create()
    
    try {
        const cleanBase64 = summaryBase64.includes(',') ? summaryBase64.split(',')[1] : summaryBase64
        const summaryBytes = Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0))
        
        // Embutir a imagem (PNG ou JPG)
        let summaryImg;
        try {
            summaryImg = await mergedPdf.embedPng(summaryBytes)
        } catch (e) {
            console.log('Tentando embutir como JPG após falha no PNG...')
            summaryImg = await mergedPdf.embedJpg(summaryBytes)
        }
        
        const page = mergedPdf.addPage([summaryImg.width, summaryImg.height])
        page.drawImage(summaryImg, {
            x: 0,
            y: 0,
            width: summaryImg.width,
            height: summaryImg.height,
        })
        console.log('Demonstrativo (Imagem) embutido com sucesso')
    } catch (imgErr: any) {
        console.error('Erro ao embutir imagem do demonstrativo:', imgErr.message)
        throw new Error(`Falha ao processar imagem do demonstrativo: ${imgErr.message}`)
    }

    // 2. Buscar o PDF do Boleto no Asaas
    console.log(`Buscando boleto em: ${asaasUrl}`)
    const asaasRes = await fetch(asaasUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
    })
    if (!asaasRes.ok) throw new Error(`Erro ao buscar boleto no Asaas (${asaasRes.status}): ${asaasRes.statusText}`)
    
    const asaasBytes = await asaasRes.arrayBuffer()
    const asaasDoc = await PDFDocument.load(asaasBytes)

    // 3. Buscar o PDF da Conta de Energia (opcional)
    let energyBillDoc = null
    if (energyBillUrl) {
      console.log(`Buscando conta de energia em: ${energyBillUrl}`)
      try {
        const energyRes = await fetch(energyBillUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        })
        if (energyRes.ok) {
          const energyBytes = await energyRes.arrayBuffer()
          if (energyBytes.byteLength > 0) {
              try {
                  energyBillDoc = await PDFDocument.load(energyBytes)
                  console.log(`Conta de energia carregada com sucesso (${energyBillDoc.getPageCount()} páginas)`)
              } catch (loadErr: any) {
                  console.error('Erro ao carregar PDF da conta:', loadErr.message)
              }
          }
        } else {
          console.error(`Erro ao buscar conta de energia. Status: ${energyRes.status}`)
        }
      } catch (e: any) {
        console.error('Erro de rede ao buscar conta de energia:', e.message)
      }
    }

    // 4. Agrupar as páginas
    // O mergedPdf já tem o Demonstrativo (página 1)
    
    // Adicionar Boleto Asaas
    const asaasPages = await mergedPdf.copyPages(asaasDoc, asaasDoc.getPageIndices())
    asaasPages.forEach(p => mergedPdf.addPage(p))

    // Adicionar Conta de Energia (se disponível)
    if (energyBillDoc) {
        const energyPages = await mergedPdf.copyPages(energyBillDoc, energyBillDoc.getPageIndices())
        energyPages.forEach(p => mergedPdf.addPage(p))
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
