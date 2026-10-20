-- Campos declarados nos 8 funis da ponte (Recepção + 7 produtos)
-- (spec docs/superpowers/specs/2026-10-20-bel-recepcao-design.md §7.1).
--
-- Sem campo declarado, o crm_update_lead do Deskcomm não tem onde gravar
-- (lib/mcp/tools/leads.ts: custom_fields = os campos de pipeline.settings.fields).
-- Escopo "negocio" (o padrão): o valor fica no card e vai junto quando o
-- roteador clona o card para o funil do especialista (montaPayloadDoClone).
--
-- Idempotente: acrescenta por chave e preserva campos que alguém já criou na tela.

do $$
declare
    v_campos constant jsonb := $j$[
        {"key": "cidade",         "label": "Cidade",              "type": "text"},
        {"key": "uf",             "label": "UF",                  "type": "text"},
        {"key": "concessionaria", "label": "Concessionária",      "type": "text"},
        {"key": "consumo_kwh",    "label": "Consumo médio (kWh)", "type": "number"},
        {"key": "origem",         "label": "Origem",              "type": "select",
         "options": [
            {"value": "instagram", "label": "Instagram"},
            {"value": "google",    "label": "Google"},
            {"value": "facebook",  "label": "Facebook"},
            {"value": "indicacao", "label": "Indicação"},
            {"value": "site",      "label": "Site"},
            {"value": "outro",     "label": "Outro"}]},
        {"key": "indicado_por",   "label": "Indicado por",        "type": "text"},
        {"key": "lista_espera",   "label": "Lista de espera (fora da área)", "type": "boolean"}
    ]$j$;
    p record;
    v_atuais jsonb;
    v_novos  jsonb;
begin
    for p in
        select cp.id, cp.settings
          from crm_pipelines cp
          join ponte_deskcomm.categorias c on c.pipeline_id = cp.id
    loop
        v_atuais := case when jsonb_typeof(p.settings->'fields') = 'array' then p.settings->'fields' else '[]'::jsonb end;
        select coalesce(jsonb_agg(f), '[]'::jsonb) into v_novos
          from jsonb_array_elements(v_campos) f
         where not exists (select 1 from jsonb_array_elements(v_atuais) a where a->>'key' = f->>'key');
        if jsonb_array_length(v_novos) > 0 then
            update crm_pipelines
               set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('fields', v_atuais || v_novos)
             where id = p.id;
        end if;
    end loop;
end $$;
