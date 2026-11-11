-- Lead é gravado com o DDI (55 + DDD + número).
--
-- O portão da página das usinas (`usina-acesso`) envia o código de confirmação
-- e procura o lead pelo número exato com o DDI. O modal do CRM recusava número
-- digitado com 55 (corrigido no front nesta mesma entrega), e o simulador
-- público gravava sem ele: `fn_registrar_lead_publico` normaliza o telefone com
-- `fn_telefone_br`, que tira o 55, e inseria esse valor. O lead do simulador
-- nunca recebia o código.
--
-- A comparação continua por `fn_telefone_br` dos dois lados, então achar o lead
-- da mesma pessoa não muda; só o número gravado num lead NOVO ganha o 55.
--
-- Troca só o trecho do INSERT na definição em produção, em vez de redigitar a
-- função inteira, e para se o trecho não estiver lá.
do $$
declare
    v_def  text := pg_get_functiondef('public.fn_registrar_lead_publico(jsonb, text, text)'::regprocedure);
    v_novo text;
begin
    v_novo := replace(v_def,
        $a$VALUES (btrim(p_dados ->> 'name'), v_email, v_tel, p_dados ->> 'cep'$a$,
        $b$VALUES (btrim(p_dados ->> 'name'), v_email, '55' || v_tel, p_dados ->> 'cep'$b$);
    if v_novo = v_def then
        raise exception 'fn_registrar_lead_publico: trecho do INSERT não encontrado; nada alterado';
    end if;
    execute v_novo;
end $$;

-- O único lead antigo sem DDI (simulador, 22/10/2026) NÃO é corrigido aqui: a
-- mesma pessoa já tem outro lead com o número e o 55. Pôr o 55 no antigo deixa
-- dois leads com o mesmo telefone, e o `usina-acesso` (maybeSingle por número)
-- passa a falhar no login dela. O caso é de mesclar os dois leads, à mão.
