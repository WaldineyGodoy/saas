-- Mídia recebida fora da coleta da adesão virava "documento", 28/10/2026.
--
-- fn_adesao_midia descartava a mídia com `v_etapa not in (...)`, mas com a
-- etapa vazia (card ainda na simulação) a comparação dá NULL, o IF não entra
-- e a função seguia para o ramo do documento: a conta de luz mandada na
-- simulação foi gravada como documento de identidade e criou uma adesão. Com
-- coalesce, só as etapas aguardando_conta e aguardando_documento seguem.
--
-- Limpeza: as adesões criadas por mídia fora da coleta perdem o documento
-- falso; a que foi criada só por isso (card sem etapa) é apagada.

create or replace function ponte_deskcomm.fn_adesao_midia()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
    v_card  uuid;
    v_etapa text;
begin
    if new.direction <> 'inbound' or new.media_storage_path is null then return null; end if;
    if tg_op = 'UPDATE' and old.media_storage_path is not null then return null; end if;
    select ponte_deskcomm.fn_card_assinatura(cv.contact_id) into v_card from conversations cv where cv.id = new.conversation_id;
    if v_card is null then return null; end if;
    select custom_fields->>'adesao_etapa' into v_etapa from crm_leads where id = v_card;
    if coalesce(v_etapa, '') not in ('aguardando_conta', 'aguardando_documento') then return null; end if;

    insert into ponte_deskcomm.adesoes (card_id) values (v_card) on conflict do nothing;
    if v_etapa = 'aguardando_conta' then
        update ponte_deskcomm.adesoes set conta_message_id = new.id, atualizado_em = now() where card_id = v_card;
        perform ponte_deskcomm.fn_chamar_funcao('adesao-whatsapp', jsonb_build_object('acao', 'conta', 'card_id', v_card));
    else
        update ponte_deskcomm.adesoes set documento_message_id = new.id, atualizado_em = now() where card_id = v_card;
        perform ponte_deskcomm.fn_chamar_funcao('adesao-whatsapp', jsonb_build_object('acao', 'documento', 'card_id', v_card));
    end if;
    return null;
exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem) values ('fn_adesao_midia', new.id, sqlstate, sqlerrm);
    return null;
end
$$;

-- Documento gravado de uma mídia que chegou antes de a adesão pedir documento
-- (a etapa do card só passou a aguardando_* depois): é falso.
with falsos as (
    select a.card_id
      from ponte_deskcomm.adesoes a
      join crm_leads cl on cl.id = a.card_id
     where a.documento_message_id is not null
       and a.subscriber_id is null
       and coalesce(cl.custom_fields->>'adesao_etapa', '') <> 'aguardando_documento'
       and a.conta_message_id is null
)
update ponte_deskcomm.adesoes a
   set documento_message_id = null,
       erros = coalesce(a.erros, '{}'::jsonb) - 'documento',
       atualizado_em = now()
  from falsos f
 where a.card_id = f.card_id;

-- Adesão que só existia por causa do documento falso (card sem etapa).
delete from ponte_deskcomm.adesoes a
 using crm_leads cl
 where cl.id = a.card_id
   and coalesce(cl.custom_fields->>'adesao_etapa', '') = ''
   and a.documento_message_id is null and a.conta_message_id is null
   and a.conta_lida is null and a.subscriber_id is null and a.signature_link is null;
