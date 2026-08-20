-- Move as senhas que estavam em texto puro para o Vault.
--
-- fn_set_portal_password ja apaga a chave 'password' do jsonb, entao o texto
-- puro sai da linha no mesmo passo. Nenhum valor e retornado ou registrado.
--
-- Eram 7: 3 em usinas, 2 em subscribers, 2 em consumer_units.

do $$
declare
    r record;
    v_tabela text;
    v_movidas int := 0;
begin
    foreach v_tabela in array array['subscribers', 'usinas', 'consumer_units'] loop
        for r in execute format(
            'select id, portal_credentials->>''password'' as senha
               from public.%I
              where length(coalesce(portal_credentials->>''password'', '''')) > 0', v_tabela)
        loop
            perform public.fn_set_portal_password(v_tabela, r.id, r.senha);
            v_movidas := v_movidas + 1;
        end loop;
    end loop;

    raise notice 'senhas movidas para o Vault: %', v_movidas;
end;
$$;

-- A chave 'url' continua no jsonb de proposito: e dado de cadastro antigo,
-- nao segredo. So 'password' sai.
