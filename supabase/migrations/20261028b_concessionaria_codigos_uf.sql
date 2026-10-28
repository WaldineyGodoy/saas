-- Tabela "Concessionaria": 39 linhas com município, UF e código IBGE que não
-- batem entre si, 28/10/2026.
--
-- A tabela foi montada casando o código IBGE só pelo nome da cidade, então
-- homônimos de estados diferentes trocaram de lugar. Três tipos de erro,
-- decididos pela distribuidora que a ANEEL aponta para cada código (INDGER,
-- dados comerciais, UCs ativas por município, ref. 09/2026):
--   1. UF errada: o código e a distribuidora conferem, a UF era a da sede da
--      distribuidora (ex.: Três Lagoas é MS, atendida pela Elektro).
--   2. Código errado: a cidade e a distribuidora conferem, o código era de um
--      homônimo (ex.: Floresta/PE estava com o código de Floresta/PR, e uma UC
--      de Floresta/PR pegava a tarifa da Neoenergia Pernambuco).
--   3. Distribuidora errada: a linha é refeita com a distribuidora da ANEEL,
--      copiando os valores da linha mais comum dessa distribuidora.
-- As consultas por código (tarifa da UC, adesão) passam a achar a linha certa.

-- 1. UF errada: nome e UF do IBGE para o código.
update "Concessionaria" c
   set "UF" = m.uf, "Município" = m.nome
  from ponte_deskcomm.municipios_ibge m
 where m.codigo::text = c."Cod. Ibge"
   and c."Cod. Ibge" in ('4201109', '3303401', '4215604', '3305703', '4213609', '2927002', '5000807',
                         '3104106', '5002308', '3109105', '3110509', '3110608', '3119906', '3125101',
                         '3132909', '3133600', '3143807', '5007554', '5007802', '3165578', '5008305');

-- 2. Código errado. Santa Terezinha/MT sai do código da BA antes de a linha
--    da BA ocupá-lo.
update "Concessionaria" c
   set "Cod. Ibge" = v.novo
  from (values ('5100201', '3100609'), ('2928505', '5107776'), ('4107900', '2605707'),
               ('4110300', '2607000'), ('2512606', '2611533'), ('4124806', '2613206'),
               ('3169109', '4127700'), ('2917904', '2405108')) v(antigo, novo)
 where c."Cod. Ibge" = v.antigo;

update "Concessionaria" c
   set "Cod. Ibge" = v.novo, "Município" = m.nome, "UF" = m.uf
  from (values ('2513802', '2928505'), ('2502201', '5203500')) v(antigo, novo)
  join ponte_deskcomm.municipios_ibge m on m.codigo::text = v.novo
 where c."Cod. Ibge" = v.antigo;

-- 3. Distribuidora errada: refaz a linha a partir da linha-modelo da
--    distribuidora certa (a combinação de valores mais comum dela).
create temporary table _modelo on commit drop as
select distinct on (conc) conc, cod
  from (select btrim(c."Concessionaria") conc, c."Cod. Ibge" cod,
               count(*) over (partition by btrim(c."Concessionaria"),
                   to_jsonb(c) - 'Cod. Ibge' - 'Município' - 'UF') n
          from "Concessionaria" c) z
 order by conc, n desc, cod;

create temporary table _refazer on commit drop as
select v.cod, v.conc, m.nome, m.uf
  from (values ('3301207', 'Light'), ('3505005', 'Neoenergia Elektro'), ('3515400', 'Neoenergia Elektro'),
               ('3523206', 'Neoenergia Elektro'), ('3543501', 'Neoenergia Elektro'),
               ('4210704', 'Celesc-Dis'), ('3549805', 'CPFL Paulista')) v(cod, conc)
  join ponte_deskcomm.municipios_ibge m on m.codigo::text = v.cod;

delete from "Concessionaria" c using _refazer r where c."Cod. Ibge" = r.cod;

insert into "Concessionaria"
select (jsonb_populate_record(null::"Concessionaria",
            to_jsonb(t) || jsonb_build_object('Cod. Ibge', r.cod, 'Município', r.nome, 'UF', r.uf))).*
  from _refazer r
  join _modelo mo on mo.conc = r.conc
  join "Concessionaria" t on t."Cod. Ibge" = mo.cod;
