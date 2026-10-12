import { describe, test, expect } from 'vitest';
import { ehRecusaDeNovaVersao, textoConfirmaNovaVersao, versaoSucessora } from '../src/lib/planoAssinaturaVersao.js';

describe('versao do plano de assinatura', () => {
    test('reconhece a recusa da trava pelo texto do banco', () => {
        expect(ehRecusaDeNovaVersao({ message: 'O plano "X" ja tem UC ou eletroposto vinculado: ... Crie uma nova versao.' })).toBe(true);
        expect(ehRecusaDeNovaVersao({ message: 'permission denied' })).toBe(false);
        expect(ehRecusaDeNovaVersao(null)).toBe(false);
    });

    test('texto de confirmacao diz que as UCs atuais ficam no plano antigo', () => {
        const t = textoConfirmaNovaVersao('Plano Premium');
        expect(t).toMatch(/Plano Premium/);
        expect(t).toMatch(/nova versão/i);
        expect(t).toMatch(/continuam/i);
    });

    test('acha a versao ativa que substitui o plano', () => {
        const planos = [
            { id: 'a', status: 'somente_contratos', substitui_plano_id: null },
            { id: 'b', status: 'somente_contratos', substitui_plano_id: 'a' },
            { id: 'c', status: 'ativo', substitui_plano_id: 'b' }
        ];
        expect(versaoSucessora(planos, planos[1])?.id).toBe('c');
        expect(versaoSucessora(planos, planos[0])?.id).toBe('c');
        expect(versaoSucessora(planos, planos[2])).toBeNull();
    });
});
