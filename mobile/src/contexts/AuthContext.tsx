import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
        qc.clear();
        return null;
      },
      async signOut() {
        if (DEMO) return;
        await supabase.auth.signOut();
        qc.clear();
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
