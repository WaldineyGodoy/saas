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
      throw new Error('Demonstrativo (base64) e URL do Boleto são obrigatórios.')
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

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
    try {
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
    } catch (e) {
        throw new Error(`Erro ao processar demonstrativo: ${e.message}`)
    }

    // 2. Buscar Boleto no Asaas
    console.log(`Merge: Buscando boleto em ${asaasUrl}`)
    let asaasRes;
    let retries = 4;
    const fetchHeaders: any = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/pdf, */*'
    }
    
    if ((asaasUrl.includes('/api/v3/') || asaasUrl.includes('asaas.com/api')) && asaasKey) {
        fetchHeaders['access_token'] = asaasKey
    }

    while (retries > 0) {
        try {
            asaasRes = await fetch(asaasUrl, { headers: fetchHeaders })
            if (asaasRes.ok) break;
            
            const errorBody = await asaasRes.text().catch(() => 'no body');
            console.warn(`Tentativa falhou (${asaasRes.status}). Body: ${errorBody.substring(0, 100)}`)
            
            if (asaasRes.status === 404 || asaasRes.status === 401) break; // Não adianta retentar se sumiu ou não tem acesso
        } catch (fetchErr: any) {
            console.warn(`Erro de rede: ${fetchErr.message}`)
        }
        
        await new Promise(r => setTimeout(r, 2000))
        retries--;
    }

    if (!asaasRes || !asaasRes.ok) {
        if (asaasRes?.status === 500) {
            throw new Error(`O Asaas falhou em gerar o PDF do boleto (Erro 500). Isso ocorre frequentemente no Sandbox quando a cobrança é nova ou foi alterada recentemente. Tente novamente em alguns segundos.`)
        }
        if (asaasRes?.status === 404) {
            throw new Error(`Boleto não encontrado no Asaas (404). O link pode ter expirado ou a cobrança foi removida.`)
        }
        throw new Error(`Não foi possível obter o boleto do Asaas (Status ${asaasRes?.status || 'desconhecido'}).`)
    }
    
    const asaasBytes = await asaasRes.arrayBuffer()
    const asaasDoc = await PDFDocument.load(asaasBytes)
    const asaasPages = await mergedPdf.copyPages(asaasDoc, asaasDoc.getPageIndices())
    asaasPages.forEach(p => mergedPdf.addPage(p))

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
      } catch (e) {
          console.warn(`Erro ao anexar fatura concessionária: ${e.message}`)
      }
    }

    // 4. Finalizar
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
