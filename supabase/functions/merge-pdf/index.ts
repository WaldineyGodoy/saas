import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

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

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Buscar Configuração do Asaas para ter a API Key (caso o link exija auth)
    const { data: config } = await supabase
        .from('integrations_config')
        .select('*')
        .eq('service_name', 'financial_api')
        .single()

    const asaasKey = config?.environment === 'sandbox' ? config?.sandbox_api_key : config?.api_key

    const mergedPdf = await PDFDocument.create()
    const cleanBase64 = summaryBase64.includes(',') ? summaryBase64.split(',')[1] : summaryBase64
    const summaryBytes = Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0))

    // 1. Processar Demonstrativo
    const isPdf = cleanBase64.startsWith('JVBERi0')
    if (isPdf) {
      const summaryDoc = await PDFDocument.load(summaryBytes)
      const summaryPages = await mergedPdf.copyPages(summaryDoc, summaryDoc.getPageIndices())
      summaryPages.forEach(p => mergedPdf.addPage(p))
    } else {
      const summaryImg = await mergedPdf.embedPng(summaryBytes).catch(() => mergedPdf.embedJpg(summaryBytes))
      const page = mergedPdf.addPage([summaryImg.width, summaryImg.height])
      page.drawImage(summaryImg, { x: 0, y: 0, width: summaryImg.width, height: summaryImg.height })
    }

    // 2. Buscar o PDF do Boleto no Asaas com RETRY e Headers de Navegador
    console.log(`Merge: Buscando boleto em ${asaasUrl}`)
    let asaasRes;
    let retries = 4;
    const fetchHeaders: any = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/pdf, */*'
    }
    
    // Se a URL do Asaas for do tipo API, precisamos do token
    if (asaasUrl.includes('/api/v3/') && asaasKey) {
        fetchHeaders['access_token'] = asaasKey
    }

    while (retries > 0) {
        try {
            asaasRes = await fetch(asaasUrl, { headers: fetchHeaders })
            if (asaasRes.ok) break;
            
            const errorBody = await asaasRes.text().catch(() => 'no body');
            console.warn(`Tentativa falhou (${asaasRes.status}). Body: ${errorBody.substring(0, 100)}. Retentando...`)
        } catch (fetchErr: any) {
            console.warn(`Erro de rede ao buscar boleto: ${fetchErr.message}`)
        }
        
        await new Promise(r => setTimeout(r, 2000))
        retries--;
    }

    if (!asaasRes || !asaasRes.ok) {
        throw new Error(`Asaas retornou erro ${asaasRes?.status || 'desconhecido'} ao buscar o boleto. Certifique-se que o boleto está disponível no Sandbox.`)
    }
    
    const asaasBytes = await asaasRes.arrayBuffer()
    const asaasDoc = await PDFDocument.load(asaasBytes)

    // 3. Buscar Conta de Energia (opcional)
    if (energyBillUrl) {
      try {
        const energyRes = await fetch(energyBillUrl)
        if (energyRes.ok) {
          const energyBytes = await energyRes.arrayBuffer()
          const energyBillDoc = await PDFDocument.load(energyBytes)
          const energyPages = await mergedPdf.copyPages(energyBillDoc, energyBillDoc.getPageIndices())
          energyPages.forEach(p => mergedPdf.addPage(p))
        }
      } catch (e) {}
    }

    // 4. Finalizar
    const asaasPages = await mergedPdf.copyPages(asaasDoc, asaasDoc.getPageIndices())
    asaasPages.forEach(p => mergedPdf.addPage(p))

    const mergedBytes = await mergedPdf.save()

    return new Response(mergedBytes, {
      headers: { ...corsHeaders, 'Content-Type': 'application/pdf' }
    })

  } catch (err: any) {
    console.error('Erro merge-pdf:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
