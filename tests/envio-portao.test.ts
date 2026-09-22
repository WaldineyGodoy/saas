import { describe, test, expect } from 'vitest';
import { PAPEIS_INTERNOS, decidirPortao, papelDoBearer, textoParaHtml } from '../supabase/functions/_shared/envio-portao';

const jwt = (payload: object) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.y`;

describe('portão de envio', () => {
  test('service_role passa', () => expect(decidirPortao({ bearerRole: 'service_role', userRole: null, segredoOk: false }).ok).toBe(true));
  test('segredo interno passa', () => expect(decidirPortao({ bearerRole: 'anon', userRole: null, segredoOk: true }).ok).toBe(true));
  test('anon sem segredo barra', () => expect(decidirPortao({ bearerRole: 'anon', userRole: null, segredoOk: false }).ok).toBe(false));
  test('admin passa', () => expect(decidirPortao({ bearerRole: 'authenticated', userRole: 'admin', segredoOk: false }).ok).toBe(true));
  // Task 14: qualquer um vira originator pelo cadastro publico de embaixador.
  test('originador barra', () => expect(decidirPortao({ bearerRole: 'authenticated', userRole: 'originator', segredoOk: false }).ok).toBe(false));
  test('lista interna sem originator', () => expect(PAPEIS_INTERNOS).toEqual(['super_admin', 'admin', 'manager', 'coordinator']));
  test('assinante barra', () => expect(decidirPortao({ bearerRole: 'authenticated', userRole: 'subscriber', segredoOk: false }).ok).toBe(false));
  test('lê role do JWT', () => expect(papelDoBearer(`Bearer ${jwt({ role: 'service_role' })}`)).toBe('service_role'));
  test('bearer lixo vira null', () => expect(papelDoBearer('Bearer abc')).toBeNull());
  test('texto vira html escapado com quebras', () =>
    expect(textoParaHtml('Olá <b>\nlink')).toBe('<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">Olá &lt;b&gt;<br>link</p>'));

  // Chaves novas do Supabase (sb_secret_/sb_publishable_) não são JWT: papelDoBearer
  // não teria como decodificar `role` delas. Quando o bearer bate exatamente com a
  // service role key do ambiente, trata como service_role por igualdade de string.
  test('bate por igualdade com a service role key (formato não-JWT)', () =>
    expect(papelDoBearer('Bearer sb_secret_abc123', 'sb_secret_abc123')).toBe('service_role'));
  test('chave de service role não informada não quebra o parsing normal', () =>
    expect(papelDoBearer(`Bearer ${jwt({ role: 'authenticated' })}`, undefined)).toBe('authenticated'));
});
