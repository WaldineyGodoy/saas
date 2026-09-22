/**
 * Papel interno — o mesmo conjunto que `public.fn_papel_interno()` usa no banco.
 *
 * IMPORTANTE: manter sincronizado com a funcao SQL. Ela e quem decide de
 * verdade (RLS de `invoices` e `ledger_entries`, migracao
 * 20260922h_invoices_pagamento_admin); isto aqui so evita mostrar botao que o
 * banco vai recusar. Se as duas listas divergirem, a tela mente — para mais ou
 * para menos — e ninguem descobre até alguem clicar.
 *
 * Regra do dono (22/09/2026): "embaixador nao pode marcar fatura como paga,
 * somente admins".
 */
export const PAPEIS_INTERNOS = ['super_admin', 'admin', 'manager', 'coordinator'];

export const ehPapelInterno = (papel) => PAPEIS_INTERNOS.includes(papel);
