-- Sandbox: usinas com cotas (spec 2026-10-20-base-agente-cotas-design.md §4.2, §7.2).
-- Rodar depois da migration 20261021b; tudo é desfeito no RAISE final.
DO $t$
DECLARE n int; v_nomes text;
BEGIN
  UPDATE usinas SET a_venda = false;
  INSERT INTO usinas (name, status, a_venda, modelo_venda, valor_investido, cotas_vendidas) VALUES
    ('Cota Livre', 'pre_operacao', true, 'cotas', 315000, 3),
    ('Cota Esgotada', 'pre_operacao', true, 'cotas', 315000, 10),
    ('Integral', 'pre_operacao', true, 'integral', 315000, 0),
    ('Fora de Venda', 'pre_operacao', false, 'cotas', 315000, 0),
    ('Cancelada', 'cancelada', true, 'cotas', 315000, 0);
  SELECT count(*), string_agg(nome, ',') INTO n, v_nomes FROM public.ponte_deskcomm_usinas_cotas();
  IF n <> 1 OR v_nomes <> 'Cota Livre' THEN RAISE EXCEPTION 'FALHOU filtro: % %', n, v_nomes; END IF;
  IF (SELECT cotas_vendidas FROM public.ponte_deskcomm_usinas_cotas()) <> 3 THEN RAISE EXCEPTION 'FALHOU vendidas'; END IF;
  BEGIN
    UPDATE usinas SET cotas_vendidas = 11 WHERE name = 'Cota Livre';
    RAISE EXCEPTION 'FALHOU check aceitou 11';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM ponte_deskcomm.fontes_base WHERE chave IN ('cotas_faq', 'usinas_cotas')) <> 2 THEN
    RAISE EXCEPTION 'FALHOU chaves'; END IF;
  RAISE EXCEPTION 'SANDBOX_OK';
END
$t$;
