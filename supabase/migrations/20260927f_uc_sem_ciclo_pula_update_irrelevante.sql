-- Task 2 (Split de Pagamentos) — fix round 1, F2 (Minor).
--
-- fn_uc_sem_ciclo() roda em toda UPDATE de consumer_units, mesmo quando
-- indicado_por_uc_id nem muda (leitura de medidor, troca de status, etc.).
-- Cada UPDATE assim faz pelo menos duas consultas extras (subscriber_id da
-- UC indicadora + o primeiro passo da subida da cadeia) sem necessidade,
-- porque o valor ja foi validado da ultima vez que realmente mudou.
--
-- Curto-circuito: se e UPDATE e indicado_por_uc_id nao mudou, sai logo
-- depois do curto-circuito de NULL, antes de tocar o banco de novo.

CREATE OR REPLACE FUNCTION public.fn_uc_sem_ciclo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cursor uuid;
  v_subscriber_indicadora uuid;
  v_hops integer := 0;
BEGIN
  IF NEW.indicado_por_uc_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- UPDATE que nao mexeu em indicado_por_uc_id: o valor ja foi validado da
  -- ultima vez que mudou, nao ha ciclo novo para checar.
  IF TG_OP = 'UPDATE' AND NEW.indicado_por_uc_id IS NOT DISTINCT FROM OLD.indicado_por_uc_id THEN
    RETURN NEW;
  END IF;

  IF NEW.indicado_por_uc_id = NEW.id THEN
    RAISE EXCEPTION 'A UC % nao pode ser indicada por ela mesma.', NEW.id
      USING ERRCODE = '22023';
  END IF;

  SELECT subscriber_id INTO v_subscriber_indicadora
    FROM public.consumer_units WHERE id = NEW.indicado_por_uc_id;

  IF NEW.subscriber_id IS NOT NULL
     AND v_subscriber_indicadora IS NOT NULL
     AND v_subscriber_indicadora = NEW.subscriber_id THEN
    RAISE EXCEPTION 'A UC % nao pode ser indicada por outra UC do mesmo assinante.', NEW.id
      USING ERRCODE = '22023';
  END IF;

  -- Sobe a cadeia de indicado_por_uc_id procurando a propria UC de volta.
  v_cursor := NEW.indicado_por_uc_id;
  WHILE v_cursor IS NOT NULL AND v_hops < 50 LOOP
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'A cadeia de indicacao a partir da UC % formaria um ciclo.', NEW.id
        USING ERRCODE = '22023';
    END IF;
    SELECT indicado_por_uc_id INTO v_cursor FROM public.consumer_units WHERE id = v_cursor;
    v_hops := v_hops + 1;
  END LOOP;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_uc_sem_ciclo() IS
  'Recusa (ERRCODE 22023) indicado_por_uc_id que aponte para a propria UC, para UC do mesmo assinante, ou que feche um ciclo subindo a cadeia (teto de 50 saltos). UPDATE que nao muda indicado_por_uc_id sai no curto-circuito, sem revalidar.';

-- O gatilho ja existe (BEFORE INSERT OR UPDATE em consumer_units, 20260927a);
-- so a funcao mudou.
