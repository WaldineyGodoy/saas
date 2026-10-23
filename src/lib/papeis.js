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

/**
 * Quem escreve em `subscriber_documents` e no bucket `documentos-assinante`.
 *
 * É a lista de `check_user_is_admin()` no banco — uma a menos que a interna:
 * `coordinator` lê, mas não envia documento. Manter sincronizado: se a tela
 * oferecer o botão a quem o banco recusa, o clique volta com erro de RLS.
 */
export const PAPEIS_ADMIN = ['super_admin', 'admin', 'manager'];

export const ehPapelAdmin = (papel) => PAPEIS_ADMIN.includes(papel);
