import { describe, expect, it } from 'vitest';
import {
    camposEmConflito, camposPreenchidosPeloOutro, escolhasIniciais, montarCamposMesclados,
} from '../src/lib/mesclaLead';

// Caso Kelia (17/11/2026): lead antigo só com nome e telefone, lead novo completo.
const antigo = {
    name: 'Kelia', phone: '5531992150239', email: null, cpf_cnpj: null,
    status: 'simulacao', cidade: 'Barreiras', uf: 'BA', tags: ['#Investidor', '#Cotas'],
    atendente: 'Humano', originator_id: null,
};
const novo = {
    name: 'Kelia Mara de Sousa Pereira', phone: '(31) 99215-0239', email: 'kmspereira@yahoo.com.br',
    cpf_cnpj: '037.368.756-73', status: 'negociacao', cidade: 'Barreiras', uf: 'ba', cep: '47806 014',
    tags: ['#Investidor'], originator_id: 'f86a', consumo_kwh: '',
};

describe('mescla de lead duplicado', () => {
    it('só é conflito quando os dois têm valor e diferem (normalizado)', () => {
        const chaves = camposEmConflito(novo, antigo).map(c => c.key);
        expect(chaves).toEqual(['name', 'status']);
    });

    it('campo vazio aqui vem do outro sem perguntar', () => {
        expect(camposPreenchidosPeloOutro(novo, antigo).map(c => c.key)).toEqual(['atendente']);
    });

    it('padrão: o que está no modal, mas o status fica com o mais avançado', () => {
        expect(escolhasIniciais(novo, antigo)).toEqual({ name: 'atual', status: 'atual' });
        expect(escolhasIniciais(antigo, novo)).toEqual({ name: 'atual', status: 'outro' });
    });

    it('negócio perdido não vence um lead em andamento', () => {
        expect(escolhasIniciais({ status: 'negocio_perdido' }, { status: 'simulacao' }))
            .toEqual({ status: 'outro' });
    });

    it('monta o valor final respeitando a escolha, soma as tags e normaliza', () => {
        const campos = montarCamposMesclados(novo, antigo, { name: 'outro', status: 'atual' });
        expect(campos.name).toBe('Kelia');
        expect(campos.status).toBe('negociacao');
        expect(campos.phone).toBe('5531992150239');
        expect(campos.email).toBe('kmspereira@yahoo.com.br');
        expect(campos.atendente).toBe('Humano');
        expect(campos.consumo_kwh).toBeNull();
        expect(campos.tags).toEqual(['#Investidor', '#Cotas']);
    });
});
