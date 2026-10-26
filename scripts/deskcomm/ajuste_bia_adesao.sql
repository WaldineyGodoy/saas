-- Adesão pelo WhatsApp no roteiro da Bia (Energia por Assinatura), 26/10/2026.
-- Spec: docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md §3 e §5.4.
--
-- Troca o passo 5 publicado ("5. Adesão: quando o cliente topar, envie o
-- link_adesao..." até "aqui ela não exige humano.") pelo roteiro de adesão no
-- chat, e acrescenta a ferramenta mcp_externo:leitura:b2w_status_adesao.
-- Cirúrgico sobre a versão publicada (preserva a persona). Idempotente.

do $$
declare
    v_org     uuid := (select id from organizations order by created_at limit 1);
    a         record;
    v_versao  uuid := gen_random_uuid();
    v_prompt  text;
    v_ini     int;
    v_fim     int;
    v_ferramenta constant text := 'mcp_externo:leitura:b2w_status_adesao';
    v_fim_marca  constant text := 'aqui ela não exige humano.';
    v_bloco constant text := $b$5. Adesão aqui no chat (caminho padrão quando o cliente topa):
- Se ele perguntar o que precisa para aderir, contratar ou seguir, mande duas mensagens. A primeira: "Para fazer sua adesão, vou precisar de:
• endereço do imóvel
• número do cliente (está na conta de energia)
• nome completo do titular da conta
• CPF
• e-mail e telefone para contato
• foto do seu documento (RG ou CNH)
• foto ou PDF da conta de energia mais recente
A conta precisa estar no seu nome. Se estiver no nome de outra pessoa ou de empresa, me avisa que a equipe te orienta.
Com tudo em mãos, gero o contrato e te envio para assinar aqui mesmo, pelo celular." A segunda: "Tá com os documentos fácil aí em mãos? Podemos seguir?"
- Peça um dado por vez, gravando a etapa no negócio (crm_update_lead, campo adesao_etapa) ANTES de pedir: aguardando_conta ("Me manda uma foto (ou o PDF) da sua conta de luz mais recente, com todas as informações aparecendo.") → titular → aguardando_cpf → aguardando_email → aguardando_telefone → aguardando_documento ("Agora uma foto do seu RG ou CNH (frente).") → revisao → confirmado.
- Depois de cada envio do cliente, consulte b2w_status_adesao. O que a conta trouxer (endereço, número do cliente, titular) você só confirma, sem perguntar de novo.
- titular: "A conta está no nome de {titular}. É você?" Grave adesao_titular_ok (sim/não).
- CPF, e-mail e telefone: grave em adesao_cpf, adesao_email e adesao_telefone (para o telefone, pergunte "Posso usar este número do WhatsApp como telefone de contato?"; se sim, grave o número desta conversa).
- Erros em b2w_status_adesao: conta_ilegivel → "Essa foto não ficou legível, pode mandar outra mais nítida?"; cpf_invalido → "Esse CPF não está certo, pode conferir e mandar de novo?"; email_invalido e documento_invalido → diga que está errado e peça de novo. sem_cobertura e abaixo_minimo → mesmas regras da simulação.
- Pendências (titular_divergente, titular_cnpj, cpf_diferente_conta, cpf_ja_cadastrado, falha_criacao) ou o cliente mencionar mais de uma conta/unidade: mova o negócio para "Pendência de adesão" (crm_move_lead_stage), passe para humano (crm_request_human_handoff) com o motivo e diga que a equipe vai dar sequência.
- revisao: resuma (nome, CPF mascarado, e-mail, telefone, endereço, número do cliente, desconto, vencimento dia 5) e pergunte "Está tudo certo?". Se ele corrigir algo, volte à etapa daquele dado. Se confirmar, grave adesao_revisao_ok = sim e adesao_etapa = confirmado e diga "Perfeito! Estou gerando seu contrato, em instantes te mando o link aqui."
- O contrato leva alguns segundos para ficar pronto e você só fala quando há mensagem. Por isso, logo depois de confirmar, agende um retorno para daqui a 2 minutos (schedule_followup) com o motivo "entregar o link do contrato". Se o agendamento não for possível (fora do horário de envio), diga que o contrato também chega no e-mail dele e que, assim que ele responder aqui, você manda o link.
- Quando b2w_status_adesao trouxer link_assinatura (no retorno agendado ou na próxima mensagem do cliente): "Pronto! É só abrir, conferir e assinar: {link}" e mova para "Contrato enviado". Se ainda não houver link e não houver erro, diga que está quase pronto e agende outro retorno em 2 minutos. Quando vier assinado = true, agradeça.
- O link do site (link_adesao) só se o cliente preferir fazer sozinho, ou disser que vai pensar ou que volta depois: "Fico aguardando! Se preferir, pode continuar pelo {link_adesao}".
- Passe para humano também se o cliente pedir, reclamar ou travar.$b$;
begin
    select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt, v.tool_ids into a
      from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
     where ag.organization_id = v_org and ag.archived_at is null and ag.name = 'Bia · Energia por Assinatura';
    if a.id is null then raise exception 'Bia nao encontrada'; end if;

    if position('b2w_status_adesao' in a.system_prompt) > 0 and v_ferramenta = any(a.tool_ids) then
        raise notice 'Bia já está com a adesão pelo WhatsApp'; return;
    end if;

    v_ini := position('5. Adesão: quando o cliente topar' in a.system_prompt);
    v_fim := position(v_fim_marca in a.system_prompt);
    if v_ini = 0 or v_fim = 0 or v_fim < v_ini then
        raise exception 'Passo 5 antigo não encontrado no prompt da Bia: nada alterado';
    end if;
    v_prompt := substr(a.system_prompt, 1, v_ini - 1) || v_bloco
             || substr(a.system_prompt, v_fim + length(v_fim_marca));

    insert into ai_agent_versions (
        id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id,
        tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents,
        history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, status,
        created_by, followup, multimodal_input, video_frames_enabled, split_messages, split_max_chars,
        cases_enabled, operator_enabled, operator_model, operator_tool_ids, pipeline_ids,
        knowledge_source_ids, proposal_ai_draft_enabled, handoff_legal_enabled, inbound_debounce_ms)
    select v_versao, v.organization_id, v.agent_id,
           (select max(version_number) + 1 from ai_agent_versions where agent_id = a.id),
           v_prompt, v.provider, v.model, v.credential_id,
           array(select distinct unnest(v.tool_ids || array[v_ferramenta])),
           v.trigger_config, v.channel_session_id, v.max_steps, v.token_budget, v.cost_budget_cents,
           v.history_message_window, v.history_token_window, v.handoff_keywords, v.handoff_tool_enabled, 'draft',
           a.created_by, v.followup, v.multimodal_input, v.video_frames_enabled, v.split_messages, v.split_max_chars,
           v.cases_enabled, v.operator_enabled, v.operator_model, v.operator_tool_ids, v.pipeline_ids,
           v.knowledge_source_ids, v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms
      from ai_agent_versions v where v.id = a.published_version_id;

    perform * from fn_publish_ai_agent_version(v_org, a.id, v_versao);

    insert into event_log (organization_id, event_type, entity_kind, payload)
    values (v_org, 'ai_agent.published', 'ai_agent',
            jsonb_build_object('agent_id', a.id, 'version_id', v_versao,
                               'previous_version_id', a.published_version_id, 'origem', 'ajuste_bia_adesao'));
end $$;
