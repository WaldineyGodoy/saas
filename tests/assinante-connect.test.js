import { describe, it, expect } from 'vitest';
import {
    LANDING_RAIZ,
    STATUS_PODE_INDICAR,
    primeiroNome,
    buildConviteAssinanteUrl,
    buildLinkConnect,
    podeIndicar,
    textoCompartilhar,
    urlWhatsappCompartilhar,
    nomeArquivoQr,
} from '../src/lib/assinanteConnect';

const ID = 'aa11bb22-cc33-dd44-ee55-ff6677889900';

describe('primeiroNome', () => {
    it('devolve so o primeiro nome', () => {
        expect(primeiroNome('Maria Aparecida de Souza')).toBe('Maria');
    });
    it('tira espaco das pontas e espaco repetido no meio', () => {
        expect(primeiroNome('  Jose   Claudio ')).toBe('Jose');
    });
    it('aceita nome vazio sem explodir', () => {
        expect(primeiroNome('')).toBe('');
        expect(primeiroNome(null)).toBe('');
        expect(primeiroNome(undefined)).toBe('');
    });
});

describe('buildConviteAssinanteUrl', () => {
    it('monta a URL canonica da raiz com indicador e primeiro nome', () => {
        expect(buildConviteAssinanteUrl({ id: ID, name: 'Maria Aparecida' }))
            .toBe(`${LANDING_RAIZ}?indicador=${ID}&name=Maria`);
    });
    it('percent-encoda acento do primeiro nome', () => {
        expect(buildConviteAssinanteUrl({ id: ID, name: 'Joana Célia' }))
            .toBe(`${LANDING_RAIZ}?indicador=${ID}&name=Joana`);
        expect(buildConviteAssinanteUrl({ id: ID, name: 'Inês Ramos' }))
            .toBe(`${LANDING_RAIZ}?indicador=${ID}&name=In%C3%AAs`);
    });
    it('sem id nao existe link: devolve vazio em vez de link que nao atribui', () => {
        expect(buildConviteAssinanteUrl({ name: 'Maria' })).toBe('');
        expect(buildConviteAssinanteUrl(null)).toBe('');
    });
});

describe('buildLinkConnect', () => {
    it('prefere o link curto quando existe', () => {
        expect(buildLinkConnect({ id: ID, name: 'Maria', short_url: 'https://link.b2wenergia.com.br/maria-caa11' }))
            .toBe('https://link.b2wenergia.com.br/maria-caa11');
    });
    it('cai na URL longa enquanto o YOURLS nao respondeu', () => {
        expect(buildLinkConnect({ id: ID, name: 'Maria' }))
            .toBe(`${LANDING_RAIZ}?indicador=${ID}&name=Maria`);
    });
    it('sem id devolve vazio', () => {
        expect(buildLinkConnect({ name: 'Maria' })).toBe('');
    });
});

describe('podeIndicar', () => {
    it('libera quem assinou o contrato', () => {
        expect(podeIndicar({ status: 'contrato_assinado' })).toBe(true);
        expect(podeIndicar({ status: 'ativo' })).toBe(true);
        expect(podeIndicar({ status: 'ativo_inadimplente' })).toBe(true);
    });
    it('nega quem ainda nao assinou ou saiu da base', () => {
        expect(podeIndicar({ status: 'ativacao' })).toBe(false);
        expect(podeIndicar({ status: 'cancelado' })).toBe(false);
        expect(podeIndicar({ status: 'cancelado_inadimplente' })).toBe(false);
        expect(podeIndicar({ status: 'transferido' })).toBe(false);
        expect(podeIndicar({})).toBe(false);
        expect(podeIndicar(null)).toBe(false);
    });
    it('a lista de status liberados nao tem duplicata', () => {
        expect(new Set(STATUS_PODE_INDICAR).size).toBe(STATUS_PODE_INDICAR.length);
    });
});

describe('textoCompartilhar', () => {
    it('leva o link e se apresenta pelo primeiro nome', () => {
        const link = 'https://link.b2wenergia.com.br/maria-caa11';
        const texto = textoCompartilhar({ id: ID, name: 'Maria Aparecida' }, link);
        expect(texto).toContain(link);
        expect(texto).toContain('Maria');
        expect(texto).not.toContain('Aparecida');
    });
    it('sem link nao inventa mensagem', () => {
        expect(textoCompartilhar({ id: ID, name: 'Maria' }, '')).toBe('');
    });
});

describe('urlWhatsappCompartilhar', () => {
    it('encoda o texto no wa.me', () => {
        expect(urlWhatsappCompartilhar('oi tudo bem?')).toBe('https://wa.me/?text=oi%20tudo%20bem%3F');
    });
    it('sem texto devolve vazio', () => {
        expect(urlWhatsappCompartilhar('')).toBe('');
    });
});

describe('nomeArquivoQr', () => {
    it('gera nome de arquivo sem acento nem espaco', () => {
        expect(nomeArquivoQr({ id: ID, name: 'Inês Célia Ramos' })).toBe('qrcode-connect-ines.png');
    });
    it('cai num nome generico quando nao ha nome', () => {
        expect(nomeArquivoQr({ id: ID })).toBe('qrcode-connect-aa11bb22.png');
    });
});
