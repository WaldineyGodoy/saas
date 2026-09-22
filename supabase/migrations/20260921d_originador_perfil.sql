-- Task 3: papel do embaixador (originator) no cadastro publico + colunas do anon em originators_v2
--
-- Problema: o cadastro publico (OriginatorSignupForm.jsx) faz supabase.auth.signUp() e SO DEPOIS
-- insere em originators_v2. Nesse momento o gatilho handle_new_user() (em auth.users) ainda nao
-- encontra o e-mail em originators_v2 e grava profiles.role = 'lead'. Este gatilho corrige o papel
-- logo apos o INSERT em originators_v2, e o UPDATE abaixo conserta quem ja nasceu com o papel errado.

CREATE OR REPLACE FUNCTION public.fn_originador_confirmar_perfil()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- O signUp roda antes deste INSERT, entao handle_new_user nao achou o
  -- e-mail em originators_v2 e gravou 'lead'. Corrige so quem e lead.
  UPDATE public.profiles SET role = 'originator'
   WHERE id = NEW.id AND role = 'lead' AND lower(email) = lower(NEW.email);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_originador_confirmar_perfil() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_originador_confirma_perfil ON public.originators_v2;
CREATE TRIGGER trg_originador_confirma_perfil AFTER INSERT ON public.originators_v2
  FOR EACH ROW EXECUTE FUNCTION public.fn_originador_confirmar_perfil();

-- Perfis que ja nasceram errados (2 linhas confirmadas antes de aplicar: id 32e0923c-4833-477e-aa84-90a52b66fc0c
-- criado em 2026-06-03 e id edc3df03-d984-4ea1-b5c3-9dc4b31c399d criado em 2026-06-16).
UPDATE public.profiles p SET role = 'originator'
  FROM public.originators_v2 o
 WHERE o.id = p.id AND p.role = 'lead' AND lower(o.email) = lower(p.email);

-- Anon so grava as colunas do formulario publico (nunca split_commission, company_name, short_url).
REVOKE INSERT, UPDATE ON public.originators_v2 FROM anon;
GRANT INSERT (id, name, email, phone, cpf_cnpj, pix_key, pix_key_type, profession, address) ON public.originators_v2 TO anon;
