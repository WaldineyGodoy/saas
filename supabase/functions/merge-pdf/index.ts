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
    const { summaryBase64, asaasUrl, energyBillUrl, asaasPdfStorageUrl } = await req.json()

    if (!summaryBase64 || (!asaasUrl && !asaasPdfStorageUrl)) {
      throw new Error('Demonstrativo e URL do Boleto são obrigatórios.')
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
        throw new Error(`Erro no demonstrativo: ${e.message}`)
    }

    // 2. Buscar Boleto (Priorizar Storage Privado se disponível)
    const finalAsaasUrl = asaasPdfStorageUrl || asaasUrl;
    console.log(`Merge: Buscando boleto em ${finalAsaasUrl}`)
    
    let asaasRes;
    const isInternalStorage = finalAsaasUrl.includes('storage/v1/object/authenticated/invoices_pdfs');
    
    if (isInternalStorage) {
        // Buscar do Storage Privado usando Service Role (bypass RLS)
        console.log("Usando PDF do Storage Privado (Cache)");
        asaasRes = await fetch(finalAsaasUrl, {
            headers: { 
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'apikey': Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
            }
        });

        // Se o arquivo não existir no storage, tentar fallback para Asaas direto
        if (!asaasRes || !asaasRes.ok) {
            console.warn(`PDF não encontrado no Storage (${asaasRes?.status}). Tentando fallback para URL original do Asaas.`);
            asaasRes = null; // Reset para entrar no else abaixo
        }
    }

    if (!asaasRes) {
        // Fallback para download direto do Asaas (conforme lógica original)
        const fallbackUrl = asaasUrl;
        if (!fallbackUrl) throw new Error("PDF não encontrado no cache e URL original do Asaas está vazia.");
        
        console.log(`Fallback: Buscando boleto original em ${fallbackUrl}`);
        let retries = 6;
        const fetchHeaders: any = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
        if ((fallbackUrl.includes('/api/v3/') || fallbackUrl.includes('asaas.com/api')) && asaasKey) {
            fetchHeaders['access_token'] = asaasKey
        }

        while (retries > 0) {
            try {
                asaasRes = await fetch(fallbackUrl, { headers: fetchHeaders })
                if (asaasRes.ok) {
                    const contentType = asaasRes.headers.get('content-type');
                    if (contentType && contentType.includes('text/html')) {
                        console.warn("Asaas retornou HTML em vez de PDF. Retentando...")
                    } else {
                        break;
                    }
                }
                console.warn(`Tentativa fallback falhou (${asaasRes?.status}). Retentando em 3s...`)
                if (asaasRes?.status === 404 || asaasRes?.status === 401) break;
            } catch (fetchErr: any) {
                console.warn(`Erro de rede no fallback: ${fetchErr.message}`)
            }
            await new Promise(r => setTimeout(r, 3000))
            retries--;
        }
    }

    if (!asaasRes || !asaasRes.ok || (asaasRes.headers.get('content-type')?.includes('text/html'))) {
        if (asaasRes?.status === 500 || asaasRes?.ok) {
            throw new Error(`O Asaas Sandbox está demorando para gerar o PDF (Erro 500/HTML). Aguarde 10 segundos e tente novamente.`)
        }
        if (asaasRes?.status === 404) {
            throw new Error(`Boleto não encontrado no Asaas. Por favor, emita uma nova cobrança.`)
        }
        throw new Error(`Falha ao obter boleto (Status ${asaasRes?.status || '?'}).`)
    }
    
    const asaasBytes = await asaasRes.arrayBuffer()
    const asaasDoc = await PDFDocument.load(asaasBytes)
    const asaasPages = await mergedPdf.copyPages(asaasDoc, asaasDoc.getPageIndices())
    asaasPages.forEach(p => mergedPdf.addPage(p))

    // 3. Fatura Concessionária
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

    const mergedBytes = await mergedPdf.save()
    return new Response(mergedBytes, { headers: { ...corsHeaders, 'Content-Type': 'application/pdf' } })

  } catch (err: any) {
    console.error('Merge Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
