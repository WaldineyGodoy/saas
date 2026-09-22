import { describe, test, expect } from 'vitest';
import * as R from '../supabase/functions/_shared/onboarding-regras';
import { htmlEmailContrato } from '../supabase/functions/_shared/email-contrato';

describe('regras do onboarding', () => {
  test('aceita pdf de 1 MB', () => expect(R.validarArquivo({ mime: 'application/pdf', tamanho: 1_000_000 })).toBeNull());
  test('recusa doc', () => expect(R.validarArquivo({ mime: 'application/msword', tamanho: 10 })).toMatch(/PDF, JPG ou PNG/));
  test('recusa > 10 MB', () => expect(R.validarArquivo({ mime: 'image/png', tamanho: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/));
  test('caminho', () => expect(R.caminhoDocumento('s1', 'identidade', 'd1', 'image/jpeg')).toBe('s1/identidade/d1.jpg'));
  test('faltantes legíveis', () => expect(R.descreverFaltantes([{ tipo: 'identidade', numero_uc: null }, { tipo: 'conta_energia', numero_uc: '123' }]))
    .toBe('documento de identidade (CNH ou RG), conta de energia da UC 123'));
  test('link sem assinatura é recusado', () => expect(R.escolherLink({ signingLinkFound: false, url: 'https://autentique.com.br/v2/documentos/x' }).ok).toBe(false));
  test('link bom passa', () => expect(R.escolherLink({ signingLinkFound: true, url: 'https://assina.ae/abc' })).toEqual({ ok: true, url: 'https://assina.ae/abc' }));
  test('keyword única por instante', () => {
    const a = R.keywordAdesao('12345678-aaaa', new Date(1_000_000)); const b = R.keywordAdesao('12345678-aaaa', new Date(2_000_000));
    expect(a).toMatch(/^adesao-[0-9a-f]{8}-[0-9a-z]{4}$/); expect(a).not.toBe(b);
  });
  test('keyword aleatória evita colisão no mesmo segundo', () => {
    const agora = new Date(1_000_000);
    const keywords = Array.from({ length: 50 }, () => R.keywordAdesao('12345678-aaaa', agora));
    const unique = new Set(keywords);
    keywords.forEach(kw => expect(kw).toMatch(/^adesao-[0-9a-f]{8}-[0-9a-z]{4}$/));
    expect(unique.size).toBeGreaterThanOrEqual(49);
  });
  test('termos sem cpf', () => {
    const u = R.urlTermos('https://www.b2wenergia.com.br/contrato/', { link: 'https://l/x', nome: 'Ana', concessionaria: 'COSERN', desconto: 15 });
    expect(u).toContain('Linkdocontrato=https%3A%2F%2Fl%2Fx'); expect(u).toContain('desconto=15'); expect(u).not.toMatch(/cpf|endereco/);
  });
  test('whatsapp com acento e link', () => expect(R.textoWhatsappContrato('Ana', 'https://l/x')).toContain('Olá, Ana!'));
  test('email tem botão com link', () => {
    const h = htmlEmailContrato({ nome: 'Ana <x>', link: 'https://l/x', desconto: 15, concessionaria: 'COSERN' });
    expect(h).toContain('href="https://l/x"'); expect(h).toContain('Ana &lt;x&gt;'); expect(h).toContain('15%');
  });
});
