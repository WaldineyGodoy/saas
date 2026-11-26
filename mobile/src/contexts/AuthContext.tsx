import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ativarBiometria, atualizarTokenBiometria, biometriaAtiva, conferirBiometria, desativarBiometria, lerTokenBiometria,
} from '../lib/biometria';
import { DEMO } from '../lib/demo';
import { supabase } from '../lib/supabase';

const DEMO_SESSION = { user: { id: 'demo', email: 'ana@exemplo.com.br' } } as unknown as Session;

type AuthValue = {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  resetPassword: (email: string) => Promise<string | null>;
  /** Confere o codigo do e-mail de recuperacao e grava a senha nova (ja entra logado). */
  redefinirSenha: (email: string, codigo: string, senha: string) => Promise<string | null>;
  /** Apaga o login e abre pedido de cancelamento para a equipe (Edge Function excluir-conta-app). */
  excluirConta: () => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Face ID / digital: confere a biometria e abre a sessao com o token guardado. */
  entrarComBiometria: (motivo: string) => Promise<string | null>;
  /** Liga a biometria para o login atual (confere antes). null = ligada. */
  ligarBiometria: (motivo: string) => Promise<string | null>;
  desligarBiometria: () => Promise<void>;
  /** Login novo pela própria pessoa (cadastro aberto, 06/10/2026). Manda o
   *  código de 6 dígitos para o e-mail; a sessão só abre ao confirmar. */
  criarConta: (dados: { nome: string; celular: string; email: string; senha: string }) => Promise<string | null>;
  confirmarCadastro: (email: string, codigo: string) => Promise<string | null>;
  reenviarCodigoCadastro: (email: string) => Promise<string | null>;
  /** O e-mail traz link e código: quem clica no link confirma a conta fora do
   *  app, e o código passa a dar "vencido". Tenta entrar com a senha recém-criada;
   *  true = conta confirmada e sessão aberta. */
  entrarSeConfirmado: (email: string, senha: string) => Promise<boolean>;
};

const AuthContext = createContext<AuthValue | null>(null);

const traduzErro = (msg: string) => {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar.';
  if (/network|fetch/i.test(msg)) return 'Sem conexão. Verifique sua internet.';
  if (/token has expired|invalid.*(otp|token)|otp.*(expired|invalid)/i.test(msg)) return 'Código inválido ou vencido. Peça um novo código.';
  if (/should be different|same.*password/i.test(msg)) return 'A senha nova precisa ser diferente da anterior.';
  if (/password should be at least|weak/i.test(msg)) return 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
  if (/already registered|already been registered|user already exists/i.test(msg)) return 'Este e-mail já tem conta. Entre com ele ou use "Esqueci minha senha".';
  if (/signups? not allowed|signup.*disabled/i.test(msg)) return 'O cadastro pelo app ainda não está aberto.';
  return msg;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(DEMO ? DEMO_SESSION : null);
  const [loading, setLoading] = useState(!DEMO);
  // Enquanto troca a senha, o codigo ja abriu a sessao: segura o app na tela
  // de recuperacao ate gravar a senha nova (senao o login some no meio).
  const [redefinindo, setRedefinindo] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (DEMO) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // O Supabase gira o refresh token: a biometria precisa sempre do mais novo.
      if (s?.refresh_token) void atualizarTokenBiometria(s.refresh_token);
      // Troca de usuario nao pode herdar cache do anterior.
      if (!s) qc.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const value = useMemo<AuthValue>(
    () => ({
      session: redefinindo ? null : session,
      loading,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        return error ? traduzErro(error.message) : null;
      },
      async resetPassword(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
        return error ? traduzErro(error.message) : null;
      },
      async redefinirSenha(email, codigo, senha) {
        setRedefinindo(true);
        try {
          const { error: e1 } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: codigo.trim(), type: 'recovery' });
          if (e1) return traduzErro(e1.message);
          const { error: e2 } = await supabase.auth.updateUser({ password: senha });
          if (e2) {
            // Sem a senha nova, nao deixa a sessao do codigo aberta.
            await supabase.auth.signOut();
            return traduzErro(e2.message);
          }
          return null;
        } finally {
          setRedefinindo(false);
        }
      },
      async excluirConta() {
        if (DEMO) return null;
        const { data, error } = await supabase.functions.invoke('excluir-conta-app', { body: {} });
        if (error || !data?.ok) {
          let msg: string | undefined = data?.error;
          const ctx = (error as { context?: Response } | null)?.context;
          if (!msg && ctx?.json) {
            try { msg = (await ctx.json())?.error; } catch { /* corpo nao-JSON */ }
          }
          return msg || 'Não foi possível excluir a conta agora. Tente de novo.';
        }
        await supabase.auth.signOut().catch(() => {});
        await desativarBiometria();
        qc.clear();
        return null;
      },
      async criarConta({ nome, celular, email, senha }) {
        if (DEMO) return null;
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password: senha,
          options: { data: { name: nome.trim(), phone: celular } },
        });
        if (error) return traduzErro(error.message);
        // E-mail já confirmado em outra conta: o Supabase responde sem erro e
        // sem identidade nova, para não revelar quem tem conta.
        if (data.user && (data.user.identities?.length ?? 0) === 0) {
          return 'Este e-mail já tem conta. Entre com ele ou use "Esqueci minha senha".';
        }
        return null;
      },
      async confirmarCadastro(email, codigo) {
        if (DEMO) return null;
        const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: codigo.trim(), type: 'signup' });
        return error ? traduzErro(error.message) : null;
      },
      async reenviarCodigoCadastro(email) {
        if (DEMO) return null;
        const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
        return error ? traduzErro(error.message) : null;
      },
      async entrarSeConfirmado(email, senha) {
        if (DEMO) return false;
        if (!senha) return false;
        const { data, error } = await supabase.auth
          .signInWithPassword({ email: email.trim().toLowerCase(), password: senha })
          .catch(() => ({ data: { session: null }, error: true as const }));
        return !error && !!data.session;
      },
      async signOut() {
        if (DEMO) return;
        // Com biometria ativa, sai so deste aparelho: o token guardado continua
        // valendo para o proximo "Entrar com Face ID".
        if (await biometriaAtiva()) {
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          qc.clear();
          return;
        }
        // Sem rede ou com a sessão já expirada no servidor, o signOut global
        // falha; sair do aparelho tem que funcionar mesmo assim.
        const { error } = await supabase.auth.signOut().catch((e) => ({ error: e }));
        if (error) await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        qc.clear();
      },
      async entrarComBiometria(motivo) {
        if (DEMO) return null;
        const token = await lerTokenBiometria();
        if (!token) return 'Entre com a senha para ativar a biometria de novo.';
        if (!(await conferirBiometria(motivo))) return null; // cancelou: fica na tela de senha, sem erro
        const { error } = await supabase.auth.refreshSession({ refresh_token: token });
        if (error) {
          await desativarBiometria();
          return /network|fetch/i.test(error.message)
            ? 'Sem conexão. Verifique sua internet.'
            : 'Seu acesso por biometria expirou. Entre com a senha para ativar de novo.';
        }
        return null;
      },
      async ligarBiometria(motivo) {
        if (DEMO) return null;
        const { data } = await supabase.auth.getSession();
        if (!data.session) return 'Entre com a senha antes de ativar.';
        if (!(await conferirBiometria(motivo))) return 'Biometria não confirmada.';
        await ativarBiometria(data.session.refresh_token, data.session.user.email);
        return null;
      },
      async desligarBiometria() {
        await desativarBiometria();
      },
    }),
    [session, loading, qc, redefinindo],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
};
