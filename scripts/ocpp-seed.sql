-- B2W Charge / OCPP: dados do ambiente LOCAL de testes (Tarefa 10). NUNCA rodar em producao.
-- Aplicado por `node scripts/ocpp-local/db.mjs seed` (e pelo `npm run test:ocpp`). Idempotente.
--
-- Cria: plano de eletroposto com tarifa ao motorista R$ 2,15/kWh, o eletroposto "Posto Emulador
-- Local" (operando), o carregador CP_EMU_01 e os conectores 1 e 2.
--
-- Senha Basic Auth do CP_EMU_01 (e dos carregadores que os testes L3b criam): `emu-local-senha`.
-- Vale SO para este ambiente local; o hash abaixo foi gerado com gerarSenhaHash() de
-- services/ocpp-csms/src/server/auth.ts. Carregador de producao tem senha propria (RUNBOOK).
--
-- Uso manual com o emulador:
--   python -m emulator --id CP_EMU_01 --url ws://127.0.0.1:9220/ocpp --password emu-local-senha --scenario happy_path

insert into public.planos_assinatura_energia (id, nome, recorrente_config, tarifa_motorista_kwh)
values ('0cbb0000-0000-4000-8000-000000000001', 'Plano Eletroposto Local (OCPP)',
        '{"categoria_plano":"eletroposto"}'::jsonb, 2.15)
on conflict (id) do update
   set tarifa_motorista_kwh = excluded.tarifa_motorista_kwh,
       recorrente_config    = excluded.recorrente_config;

insert into public.eletropostos (id, nome, status, plano_id, qtd_carregadores, potencia_kw, tipo_recarga)
values ('0cbb0000-0000-4000-8000-000000000002', 'Posto Emulador Local', 'operando',
        '0cbb0000-0000-4000-8000-000000000001', 1, 7.4, 'AC')
on conflict (id) do update
   set status   = excluded.status,
       plano_id = excluded.plano_id;

insert into public.eletroposto_carregadores (id, eletroposto_id, ocpp_id, senha_hash, heartbeat_intervalo_s)
values ('0cbb0000-0000-4000-8000-000000000003', '0cbb0000-0000-4000-8000-000000000002', 'CP_EMU_01',
        'scrypt$16384$8$1$pvV6zn6GcJ2qvqNHEzs4Tw==$XVSJs2VsPBXS8krlrgKJEr7VwmhGukC4h+aBFtwywTo=', 60)
on conflict (ocpp_id) do update
   set senha_hash     = excluded.senha_hash,
       eletroposto_id = excluded.eletroposto_id;

-- Conectores (o CSMS os atualiza a cada StatusNotification; numero 1 e 2 no posto)
insert into public.eletroposto_conectores (carregador_id, connector_id, numero, status)
values ('0cbb0000-0000-4000-8000-000000000003', 1, 1, 'Unavailable'),
       ('0cbb0000-0000-4000-8000-000000000003', 2, 2, 'Unavailable')
on conflict (carregador_id, connector_id) do nothing;
