import { describe, it, expect } from 'vitest';
import { condicoesGestaoParaGravar, mesclarCondicoesGestao } from '../src/lib/condicoesGestao';

// Condições como a tela as guarda: texto em pt-BR.
const tela = {
    desconto: '17,5', percentualRecorrente: '20', taxaAdmin: '0', taxaRecuperacao: '10',
    diaCorte: '5', diaRepasse: '10', prazoTransferencia: '30', prazoHonorarios: '15',
    foro: 'Natal/RN', prazoFidelidadeMeses: '24', valorSetup: '1.500,00', faturasRetidas: '2'
};

describe('condições da Gestão de Créditos', () => {
    it('converte os campos da tela, incluindo fidelidade, setup, faturas retidas e foro', () => {
        const g = condicoesGestaoParaGravar(tela);
        expect(g.foro).toBe('Natal/RN');
        expect(g.desconto).toBe(17.5);
        expect(g.prazoFidelidadeMeses).toBe(24);
        expect(g.valorSetup).toBe(1500);
        expect(g.faturasRetidas).toBe(2);
    });

    it('mescla com o gravado: preserva a minuta e chaves desconhecidas, e apaga campo esvaziado', () => {
        const atual = { minutas: { gestao: 'texto à mão' }, outraChave: 'x', valorSetup: 900, faturasRetidas: 3 };
        const r = mesclarCondicoesGestao(atual, { ...tela, valorSetup: '', faturasRetidas: '', minutas: {} });
        expect(r.minutas).toEqual({ gestao: 'texto à mão' });
        expect(r.outraChave).toBe('x');
        expect(r).not.toHaveProperty('valorSetup');
        expect(r).not.toHaveProperty('faturasRetidas');
        expect(r.prazoFidelidadeMeses).toBe(24);
        expect(r.foro).toBe('Natal/RN');
    });

    it('funciona sem nada gravado', () => {
        expect(mesclarCondicoesGestao(null, tela).faturasRetidas).toBe(2);
    });
});
