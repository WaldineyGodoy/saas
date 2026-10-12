-- Status "Desligado por TT" para a UC sombra da troca de titularidade.
--
-- A sombra e o registro do numero/titular ANTIGOS, mantido so para o robo
-- buscar a conta final (devida pela B2W). Ela NUNCA foi conectada a usina, entao
-- 'desconectado' (que significa "foi ligada e foi desligada") esta errado. Nao
-- tem coluna no kanban: so aparece como etiqueta.
--
-- Este arquivo vem ANTES da migracao da TT de proposito: um valor novo de enum
-- nao pode ser usado na mesma transacao em que foi criado.
--
-- Onde 'desconectado' ja tinha efeito, o novo status segue a mesma regra:
--   * fn_get_uc_status_rank  -> mesmo degrau do desconectado;
--   * handle_invoice_status_change (fatura atrasada/paga nao mexe na UC encerrada);
--   * fn_bots_api / fn_mkt_api (contagem de UCs ativas da Cosern).
-- As funcoes sao remendadas a partir da definicao que esta no banco, em vez de
-- recriadas de memoria: se o texto esperado nao estiver la, a migracao falha
-- em vez de gravar uma versao velha por cima.

alter type public.uc_status add value if not exists 'desligado_por_tt';

create or replace function public.fn_get_uc_status_rank(status_val text)
returns integer
language plpgsql
immutable
as $$
begin
    return case status_val
        when 'em_ativacao' then 1
        when 'vinculado' then 2
        when 'em_transf_titularidade' then 3
        when 'aguardando_conexao' then 4
        when 'ativo' then 5
        when 'sem_geracao' then 6
        when 'em_atraso' then 7
        when 'desconectado' then 8
        when 'desligado_por_tt' then 8
        when 'cancelado' then 9
        when 'cancelado_inadimplente' then 10
        else 0
    end;
end;
$$;

do $$
declare
    r      record;
    v_def  text;
    v_novo text;
begin
    for r in
        select * from (values
            ('fn_bots_api',                 '''cancelado_inadimplente'',''desconectado''',
                                            '''cancelado_inadimplente'',''desconectado'',''desligado_por_tt'''),
            ('fn_mkt_api',                  '''cancelado_inadimplente'',''desconectado''',
                                            '''cancelado_inadimplente'',''desconectado'',''desligado_por_tt'''),
            ('handle_invoice_status_change','NOT IN (''desconectado'', ''cancelado'', ''cancelado_inadimplente'')',
                                            'NOT IN (''desconectado'', ''desligado_por_tt'', ''cancelado'', ''cancelado_inadimplente'')')
        ) as t(fn, de, para)
    loop
        select pg_get_functiondef(p.oid) into v_def
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.proname = r.fn;
        if v_def is null then
            raise exception 'Funcao % nao encontrada.', r.fn;
        end if;
        if position(r.de in v_def) = 0 then
            raise exception 'Funcao %: trecho esperado nao encontrado (a definicao mudou). Revise a migracao.', r.fn;
        end if;
        v_novo := replace(v_def, r.de, r.para);
        execute v_novo;
    end loop;
end $$;
