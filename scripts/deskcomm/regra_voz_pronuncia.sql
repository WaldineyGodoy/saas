-- Pronúncia na nota de voz, nos 8 agentes (07/11/2026, teste do dono).
--
-- O Deskcomm 1.103.0 manda o texto ao ElevenLabs sem dizer o idioma e sem
-- dicionário de pronúncia (lib/ai/voz/sintetizar.ts). No teste, "kWh" saiu
-- "Kwaddar" e "Waldiney" saiu "Valdine". Até o Deskcomm aceitar idioma e
-- dicionário (comentado na melgarafael/DeskcommCRM#4228), o agente escreve para
-- ser LIDO EM VOZ ALTA quando o turno vai sair em áudio — o motor avisa com o
-- bloco "Esta resposta vai sair como NOTA DE VOZ". Em texto nada muda.
--
-- Cria versão nova (cópia integral da publicada) e publica. Idempotente pelo título.

do $$
declare
    v_org    uuid := (select id from organizations order by created_at limit 1);
    v_titulo text := '## Quando a resposta sair como nota de voz';
    v_regra  text;
    a        record;
    v_versao uuid;
    v_linha  jsonb;
begin
    v_regra := E'\n\n' || v_titulo || E'\n'
        || 'Só vale quando o sistema avisar que a resposta vai sair como NOTA DE VOZ. Em texto, escreva normalmente. '
        || 'O áudio é gerado lendo o seu texto ao pé da letra, então escreva como se fala em português do Brasil:' || E'\n'
        || '- Unidades por extenso: kWh → "quilowatts-hora", kW → "quilowatts", kWp → "quilowatts-pico", MW → "megawatts", MWh → "megawatts-hora".' || E'\n'
        || '- Números, preços e porcentagens por extenso: R$ 250 → "duzentos e cinquenta reais", 15% → "quinze por cento", 1.200 → "mil e duzentos".' || E'\n'
        || '- Siglas como se falam: CPF → "cê pê éfe", UC → "unidade consumidora".' || E'\n'
        || '- O nome do cliente como se pronuncia em português: W com som de U e Y com som de I (Waldiney → "Ualdinêi", Wesley → "Uéslei", Kelly → "Kéli"). Se o nome já soa igual em português, mantenha.' || E'\n'
        || '- Sem abreviações (vc, pq, tb, etc.) e sem emojis.';

    for a in
        select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
          from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
         where ag.organization_id = v_org and ag.archived_at is null
    loop
        if position(v_titulo in a.system_prompt) > 0 then
            raise notice '% já tem a regra', a.name;
            continue;
        end if;

        v_versao := gen_random_uuid();
        select to_jsonb(v) || jsonb_build_object(
                   'id', v_versao,
                   'version_number', (select max(version_number) + 1 from ai_agent_versions where agent_id = a.id),
                   'system_prompt', rtrim(a.system_prompt) || v_regra,
                   'status', 'draft',
                   'published_at', null, 'superseded_at', null, 'created_at', now(),
                   'created_by', a.created_by)
          into v_linha
          from ai_agent_versions v where v.id = a.published_version_id;
        insert into ai_agent_versions select * from jsonb_populate_record(null::ai_agent_versions, v_linha);

        perform * from fn_publish_ai_agent_version(v_org, a.id, v_versao);

        insert into event_log (organization_id, event_type, entity_kind, payload)
        values (v_org, 'ai_agent.published', 'ai_agent',
                jsonb_build_object('agent_id', a.id, 'version_id', v_versao,
                                   'previous_version_id', a.published_version_id, 'origem', 'regra_voz_pronuncia'));
    end loop;
end $$;
