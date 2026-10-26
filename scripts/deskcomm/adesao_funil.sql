-- Campos do card e etapa "Pendência de adesão" no funil da Energia por Assinatura
-- (spec docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md §4.1 e §4.3). Idempotente.
do $$
declare
    v_pipe uuid := (select pipeline_id from ponte_deskcomm.categorias where slug = 'energia_assinatura');
    v_campos constant jsonb := $j$[
        {"key": "adesao_etapa", "label": "Adesão: etapa", "type": "select", "options": [
            {"value": "aguardando_conta", "label": "Aguardando conta"},
            {"value": "titular", "label": "Confirmando titular"},
            {"value": "aguardando_cpf", "label": "Aguardando CPF"},
            {"value": "aguardando_email", "label": "Aguardando e-mail"},
            {"value": "aguardando_telefone", "label": "Aguardando telefone"},
            {"value": "aguardando_documento", "label": "Aguardando documento"},
            {"value": "revisao", "label": "Revisão"},
            {"value": "confirmado", "label": "Confirmado"}]},
        {"key": "adesao_cpf", "label": "Adesão: CPF", "type": "text"},
        {"key": "adesao_email", "label": "Adesão: e-mail", "type": "text"},
        {"key": "adesao_telefone", "label": "Adesão: telefone", "type": "text"},
        {"key": "adesao_titular_ok", "label": "Adesão: titular confirmado", "type": "boolean"},
        {"key": "adesao_revisao_ok", "label": "Adesão: revisão confirmada", "type": "boolean"},
        {"key": "originador", "label": "Originador", "type": "text"}
    ]$j$;
    v_atuais jsonb;
    v_novos  jsonb;
begin
    if v_pipe is null then raise exception 'funil da Assinatura nao encontrado'; end if;
    select case when jsonb_typeof(settings->'fields') = 'array' then settings->'fields' else '[]'::jsonb end
      into v_atuais from crm_pipelines where id = v_pipe;
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_novos
      from jsonb_array_elements(v_campos) f
     where not exists (select 1 from jsonb_array_elements(v_atuais) a where a->>'key' = f->>'key');
    if jsonb_array_length(v_novos) > 0 then
        update crm_pipelines set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('fields', v_atuais || v_novos)
         where id = v_pipe;
    end if;

    -- Etapa nova copiando "Negociação" (todas as colunas obrigatórias vêm junto).
    if not exists (select 1 from crm_stages where pipeline_id = v_pipe and slug = 'pendencia-adesao') then
        insert into crm_stages
        select (jsonb_populate_record(null::crm_stages, to_jsonb(s) || jsonb_build_object(
            'id', gen_random_uuid(), 'name', 'Pendência de adesão', 'slug', 'pendencia-adesao', 'position', 4500,
            'description', 'Adesão pelo WhatsApp parada: titular divergente, CNPJ, várias UCs, CPF já cadastrado ou falha ao gerar o contrato. A equipe valida e dá sequência.',
            'requires_human', true, 'avisar_na_central', true, 'agent_stage_hint', null,
            'last_change_at', null, 'last_change_actor_kind', null,
            'created_at', now(), 'updated_at', now()))).*
          from crm_stages s where s.pipeline_id = v_pipe and s.slug = 'negociacao';
    end if;
end $$;
