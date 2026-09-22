import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { TIPOS_DOCUMENTO, caminhoDocumento, validarArquivo } from '../_shared/onboarding-regras.ts'

// Upload de documentos da ades\u00e3o p\u00fablica. An\u00f4nima: o port\u00e3o \u00e9 o
// onboarding_token, que s\u00f3 o dono do link tem. O navegador nunca escreve
// no bucket por conta pr\u00f3pria \u2014 recebe uma URL de upload assinada.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const BUCKET = 'documentos-assinante'
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  try {
    const b = await req.json().catch(() => ({}))
    const { data: sub } = await db.rpc('fn_onboarding_assinante_por_token', { p_token: b.token })
    if (!sub) return json({ error: 'Link de ades\u00e3o inv\u00e1lido ou expirado.' }, 401)
    if (!TIPOS_DOCUMENTO.includes(b.tipo)) return json({ error: 'Tipo de documento inv\u00e1lido.' }, 400)
    const erro = validarArquivo({ mime: b.mime, tamanho: Number(b.tamanho) })
    if (erro) return json({ error: erro }, 400)
    if (b.tipo === 'conta_energia') {
      const { data: uc } = await db.from('consumer_units').select('id').eq('id', b.consumer_unit_id).eq('subscriber_id', sub).maybeSingle()
      if (!uc) return json({ error: 'UC n\u00e3o pertence a esta ades\u00e3o.' }, 400)
    }

    if (b.acao === 'url') {
      const path = caminhoDocumento(sub as string, b.tipo, crypto.randomUUID(), b.mime)
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error) throw error
      return json({ path, token_upload: data.token })
    }

    if (b.acao === 'registrar') {
      if (typeof b.path !== 'string' || !b.path.startsWith(`${sub}/${b.tipo}/`)) return json({ error: 'Caminho inv\u00e1lido.' }, 400)
      const pasta = b.path.slice(0, b.path.lastIndexOf('/'))
      const nome = b.path.slice(b.path.lastIndexOf('/') + 1)
      const { data: lista } = await db.storage.from(BUCKET).list(pasta, { search: nome })
      if (!lista?.some(o => o.name === nome)) return json({ error: 'Arquivo n\u00e3o encontrado. Envie de novo.' }, 404)
      const { error } = await db.from('subscriber_documents').upsert({
        subscriber_id: sub, consumer_unit_id: b.tipo === 'conta_energia' ? b.consumer_unit_id : null,
        tipo: b.tipo, storage_path: b.path, mime: b.mime, tamanho: Number(b.tamanho) }, { onConflict: 'storage_path' })
      if (error) throw error
      const { data: faltantes } = await db.rpc('fn_onboarding_documentos_faltantes', { p_subscriber: sub })
      return json({ ok: true, faltantes })
    }
    return json({ error: 'A\u00e7\u00e3o inv\u00e1lida.' }, 400)
  } catch (e) {
    console.error('onboarding-documentos:', e)
    return json({ error: (e as Error).message }, 500)
  }
})
