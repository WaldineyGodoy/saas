import { describe, it, expect } from 'vitest';
import { aplicarLeituraIdentidade } from '../src/lib/documentoIdentidade';

const leitura = { tipoDocumento: 'CNH', nome: 'Maria da Silva Santos', cpf: '52998224725', cpfLido: '52998224725', nascimento: '1985-03-07', observacoes: '' };
const vazio = { cpf_cnpj: '', name: '', data_nascimento: '', representante_nome: '', representante_cpf: '' };

describe('aplicarLeituraIdentidade: pessoa fisica', () => {
    it('cadastro vazio: preenche CPF (com mascara), nome e nascimento', () => {
        const r = aplicarLeituraIdentidade(vazio, leitura);
        expect(r.patch).toEqual({ cpf_cnpj: '529.982.247-25', name: 'Maria da Silva Santos', data_nascimento: '1985-03-07' });
        expect(r.avisos).toEqual([]);
        expect(r.cpfAplicado).toBe('52998224725');
        expect(r.anexar).toBe(true);
    });

    it('CPF digitado igual ao do documento: completa nome e nascimento sem mexer no CPF', () => {
        const r = aplicarLeituraIdentidade({ ...vazio, cpf_cnpj: '529.982.247-25' }, leitura);
        expect(r.patch).toEqual({ name: 'Maria da Silva Santos', data_nascimento: '1985-03-07' });
        expect(r.cpfAplicado).toBe(null);
    });

    it('CPF digitado DIFERENTE do documento: nao muda nada (nao mistura duas pessoas) e avisa', () => {
        const r = aplicarLeituraIdentidade({ ...vazio, cpf_cnpj: '111.444.777-35' }, leitura);
        expect(r.patch).toEqual({});
        expect(r.avisos.join(' ')).toMatch(/diferente/i);
        expect(r.anexar).toBe(false);
    });

    it('nome e nascimento ja preenchidos nao sao sobrescritos; divergencia vira aviso', () => {
        const form = { ...vazio, cpf_cnpj: '529.982.247-25', name: 'Maria Silva', data_nascimento: '1990-01-01' };
        const r = aplicarLeituraIdentidade(form, leitura);
        expect(r.patch).toEqual({});
        expect(r.avisos.join(' ')).toMatch(/nome/i);
        expect(r.avisos.join(' ')).toMatch(/nascimento/i);
    });

    it('mesmo nome com outra caixa ou sem acento nao gera aviso', () => {
        const form = { ...vazio, cpf_cnpj: '529.982.247-25', name: 'MARIA DA SILVA SANTOS', data_nascimento: '1985-03-07' };
        const r = aplicarLeituraIdentidade({ ...form, name: 'María da Silva Santos' }, leitura);
        expect(r.avisos).toEqual([]);
        expect(aplicarLeituraIdentidade(form, leitura).avisos).toEqual([]);
    });

    it('CPF lido nao confere: preenche nome e nascimento, NAO o CPF, e mostra o numero lido no aviso', () => {
        const r = aplicarLeituraIdentidade(vazio, { ...leitura, cpf: '', cpfLido: '52998224726' });
        expect(r.patch).toEqual({ name: 'Maria da Silva Santos', data_nascimento: '1985-03-07' });
        expect(r.avisos.join(' ')).toContain('529.982.247-26');
        expect(r.cpfAplicado).toBe(null);
    });

    it('documento sem CPF (RG antigo): preenche o resto e pede o CPF', () => {
        const r = aplicarLeituraIdentidade(vazio, { ...leitura, cpf: '', cpfLido: '' });
        expect(r.patch.cpf_cnpj).toBeUndefined();
        expect(r.avisos.join(' ')).toMatch(/CPF/);
    });

    it('nada legivel: patch vazio e aviso', () => {
        const r = aplicarLeituraIdentidade(vazio, { tipoDocumento: 'OUTRO', nome: '', cpf: '', cpfLido: '', nascimento: '', observacoes: '' });
        expect(r.patch).toEqual({});
        expect(r.avisos.length).toBeGreaterThan(0);
        expect(r.anexar).toBe(false);
    });

    it('nao devolve campo undefined no patch', () => {
        const r = aplicarLeituraIdentidade(vazio, { ...leitura, nascimento: '' });
        expect(Object.values(r.patch).every((v) => v !== undefined && v !== '')).toBe(true);
    });
});

describe('aplicarLeituraIdentidade: pessoa juridica (documento do representante legal)', () => {
    const pj = { ...vazio, cpf_cnpj: '02.052.700/0001-55', name: 'MULTI TV COMUNICACOES LTDA' };

    it('preenche o representante e deixa empresa e nascimento intactos', () => {
        const r = aplicarLeituraIdentidade(pj, leitura);
        expect(r.patch).toEqual({ representante_nome: 'Maria da Silva Santos', representante_cpf: '529.982.247-25' });
        expect(r.cpfAplicado).toBe(null);
    });

    it('representante ja preenchido: nao sobrescreve e avisa se for outra pessoa', () => {
        const form = { ...pj, representante_nome: 'Juanribe Pagliarin', representante_cpf: '111.444.777-35' };
        const r = aplicarLeituraIdentidade(form, leitura);
        expect(r.patch).toEqual({});
        expect(r.avisos.join(' ')).toMatch(/representante/i);
        expect(r.anexar).toBe(false);
    });

    it('CPF do representante ilegivel: preenche so o nome', () => {
        const r = aplicarLeituraIdentidade(pj, { ...leitura, cpf: '', cpfLido: '' });
        expect(r.patch).toEqual({ representante_nome: 'Maria da Silva Santos' });
    });
});
