-- =====================================================================
-- Devolve ao anon o EXECUTE das funções que o site e o webapp chamam sem
-- login (bug reportado pelo dono, 14/10/2026: adesão de assinante indicado
-- pelo parceiro Daniel falhava ao concluir e caía no WhatsApp).
--
-- Um reforço feito direto no banco (fora das migrações) tirou o anon de
-- 401 das 402 funções SECURITY DEFINER. O reforço continua valendo para
-- as outras: aqui voltam só as 9 que as migrações sempre criaram públicas.
-- Autorizado pelo dono em 14/10/2026.
-- =====================================================================
GRANT EXECUTE ON FUNCTION
    public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,integer,text,text,text,text),
    public.fn_lead_adesao(uuid),
    public.fn_onboarding_estado(uuid),
    public.fn_registrar_lead_publico(jsonb,text,text),
    public.fn_indicador_publico(text),
    public.fn_eletropostos_publicos(),
    public.fn_eletroposto_publico(uuid),
    public.fn_recarga_publica(uuid),
    public.fn_recarga_status(uuid)
TO anon;
