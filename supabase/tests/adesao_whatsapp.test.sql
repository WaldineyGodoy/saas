-- Sandbox da adesão pelo WhatsApp (spec 2026-10-26-adesao-whatsapp-design.md).
-- Rodar depois da migration 20261027a. Desfaz tudo no RAISE final.
DO $t$
DECLARE
  v_org uuid; v_pipe uuid; v_contato uuid; v_card uuid; v_lead uuid; v_orig uuid; r jsonb; v_msg uuid; v_conv uuid; v_sessao uuid;
BEGIN
  SELECT c.pipeline_id, cp.organization_id INTO v_pipe, v_org
    FROM ponte_deskcomm.categorias c JOIN crm_pipelines cp ON cp.id = c.pipeline_id WHERE c.slug = 'energia_assinatura';
  SELECT id INTO v_orig FROM originators_v2 WHERE ativo ORDER BY created_at LIMIT 1;

  INSERT INTO contacts (organization_id, name, phone_number) VALUES (v_org, 'Contato Teste', '+5584999990009') RETURNING id INTO v_contato;
  INSERT INTO crm_leads (organization_id, pipeline_id, stage_id, contact_id, title, custom_fields)
  VALUES (v_org, v_pipe, (SELECT id FROM crm_stages WHERE pipeline_id = v_pipe ORDER BY position LIMIT 1), v_contato, 'Teste', '{}')
  RETURNING id INTO v_card;
  -- A ponte (trg_ponte_card_para_lead) pode já ter criado o lead da B2W e o vínculo.
  SELECT b2w_lead_id INTO v_lead FROM ponte_deskcomm.vinculos WHERE deskcomm_lead_id = v_card;
  IF v_lead IS NULL THEN
    INSERT INTO leads (name, phone) VALUES ('Contato Teste', '84999990009') RETURNING id INTO v_lead;
    INSERT INTO ponte_deskcomm.vinculos (deskcomm_lead_id, b2w_lead_id, contact_id, organization_id, categoria)
    VALUES (v_card, v_lead, v_contato, v_org, 'energia_assinatura');
  END IF;
  UPDATE leads SET originator_id = v_orig WHERE id = v_lead;

  -- 1. Originador preenchido no card.
  UPDATE crm_leads SET custom_fields = custom_fields || '{"cidade":"Natal"}' WHERE id = v_card;
  IF v_orig IS NOT NULL AND (SELECT custom_fields->>'originador' FROM crm_leads WHERE id = v_card) IS NULL THEN
    RAISE EXCEPTION 'FALHOU originador'; END IF;

  -- 2. Etapa aguardando_conta + mídia recebida -> slot da conta.
  UPDATE crm_leads SET custom_fields = custom_fields || '{"adesao_etapa":"aguardando_conta"}' WHERE id = v_card;
  SELECT channel_session_id INTO v_sessao FROM conversations WHERE organization_id = v_org AND channel = 'whatsapp' ORDER BY created_at DESC LIMIT 1;
  INSERT INTO conversations (organization_id, contact_id, channel_session_id, channel, status)
  VALUES (v_org, v_contato, v_sessao, 'whatsapp', 'open') RETURNING id INTO v_conv;
  INSERT INTO messages (organization_id, conversation_id, channel_session_id, contact_id, direction, type, media_storage_path, media_mime, media_size_bytes)
  VALUES (v_org, v_conv, v_sessao, v_contato, 'inbound', 'image', v_org || '/teste/conta.jpg', 'image/jpeg', 1000) RETURNING id INTO v_msg;
  IF (SELECT conta_message_id FROM ponte_deskcomm.adesoes WHERE card_id = v_card) IS DISTINCT FROM v_msg THEN
    RAISE EXCEPTION 'FALHOU midia conta'; END IF;

  -- 3. Dados para a Edge Function.
  r := public.ponte_deskcomm_adesao_dados(v_card);
  IF r->>'b2w_lead_id' <> v_lead::text OR r->'conta_midia'->>'mime' <> 'image/jpeg' OR r->>'telefone' <> '5584999990009' THEN
    RAISE EXCEPTION 'FALHOU dados: %', r; END IF;

  -- 4. Salvar e status para a Bia (CPF mascarado).
  PERFORM public.ponte_deskcomm_adesao_salvar(v_card, '{"conta_lida":{"titular":"CONTATO TESTE","numeroUc":"7012345","mediaKwh":300,"endereco":{"completo":"RUA A, 1, CENTRO, 59000-000 NATAL RN"}},"erros_validacao":["cpf_invalido"],"status":"coletando"}');
  UPDATE crm_leads SET custom_fields = custom_fields || '{"adesao_cpf":"52998224725","adesao_etapa":"aguardando_email"}' WHERE id = v_card;
  r := public.b2w_mcp_status_adesao('5584999990009');
  IF r->>'etapa' <> 'aguardando_email' OR r->>'cpf_mascarado' <> '***.982.247-**' OR NOT (r->'erros' ? 'cpf_invalido')
     OR r->'conta'->>'numero_cliente' <> '7012345' THEN RAISE EXCEPTION 'FALHOU status: %', r; END IF;

  -- 5. Telefone de outro contato não vê nada.
  r := public.b2w_mcp_status_adesao('5584000000000');
  IF r->>'etapa' IS NOT NULL THEN RAISE EXCEPTION 'FALHOU isolamento: %', r; END IF;

  -- 6. Auxiliares.
  IF public.ponte_deskcomm_ibge('natal', 'RN') IS NULL THEN RAISE EXCEPTION 'FALHOU ibge'; END IF;
  IF public.ponte_deskcomm_cpf_existe('00000000000') THEN RAISE EXCEPTION 'FALHOU cpf_existe'; END IF;

  RAISE EXCEPTION 'SANDBOX_OK %', r;
END
$t$;
