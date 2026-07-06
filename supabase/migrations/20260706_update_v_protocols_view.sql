-- Migration: 20260706_update_v_protocols_view
-- Description: Update v_protocols view to include usinas table for linked_entity_name

CREATE OR REPLACE VIEW public.v_protocols AS
 SELECT p.id,
    p.protocol_number,
    ( SELECT protocols.protocol_number
           FROM protocols
          WHERE protocols.parent_protocol_id = p.id AND protocols.protocol_number IS NOT NULL
          ORDER BY protocols.created_at DESC
         LIMIT 1) AS latest_sub_protocol_number,
    p.title,
    p.description,
    p.status,
    p.linked_entity_type,
    p.linked_entity_id,
    p.deadline_days,
    p.due_date,
    p.parent_protocol_id,
    p.created_at,
    p.updated_at,
    p.created_by,
    ( SELECT count(*) AS count
           FROM protocols
          WHERE protocols.parent_protocol_id = p.id) AS sub_protocols_count,
    COALESCE(sub.name, uc.titular_conta,
        CASE
            WHEN p.linked_entity_type = 'conta_energia'::text THEN ((COALESCE(uc_inv.concessionaria, 'Concessionária'::text) ||
            CASE
                WHEN uc_inv.numero_uc IS NOT NULL THEN (' (UC: '::text || uc_inv.numero_uc) || ')'::text
                ELSE ''::text
            END) || ' - Ref: '::text) || COALESCE(to_char(inv.mes_referencia::timestamp with time zone, 'MM/YYYY'::text), ''::text)
            WHEN p.linked_entity_type = 'fatura'::text THEN (((('Fatura'::text ||
            CASE
                WHEN uc_inv.numero_uc IS NOT NULL THEN (' (UC: '::text || uc_inv.numero_uc) || ')'::text
                ELSE ''::text
            END) || ' - R$ '::text) || round(inv.valor_a_pagar, 2)) || ' - Ref: '::text) || COALESCE(to_char(inv.mes_referencia::timestamp with time zone, 'MM/YYYY'::text), ''::text)
            ELSE NULL::text
        END, rl.usina_name, u.name) AS linked_entity_name
   FROM protocols p
     LEFT JOIN subscribers sub ON p.linked_entity_type = 'assinante'::text AND p.linked_entity_id = sub.id
     LEFT JOIN consumer_units uc ON p.linked_entity_type = 'unidade_consumidora'::text AND p.linked_entity_id = uc.id
     LEFT JOIN invoices inv ON (p.linked_entity_type = 'conta_energia'::text OR p.linked_entity_type = 'fatura'::text) AND p.linked_entity_id = inv.id
     LEFT JOIN consumer_units uc_inv ON inv.uc_id = uc_inv.id
     LEFT JOIN rateio_lists rl ON p.linked_entity_type = 'rateio_list'::text AND p.linked_entity_id = rl.id
     LEFT JOIN usinas u ON p.linked_entity_type = 'usina'::text AND p.linked_entity_id = u.id;
