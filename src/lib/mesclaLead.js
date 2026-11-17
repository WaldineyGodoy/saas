// Mescla de lead duplicado: quais campos entram, quais estão em conflito e o
// valor final de cada um. A gravação é a RPC `fn_mesclar_leads`
// (migração 20261117a), que também leva adiante assinaturas, agendamentos,
// histórico e vínculos do lead removido.
import { cleanDigits, normalizePhoneDdi } from './validators';

export const STATUS_LEAD = [
    { value: 'sem_interacao', label: 'Sem Interação' },
    { value: 'indicado', label: 'Indicado' },
    { value: 'qualificando', label: 'Qualificando' },
    { value: 'simulacao', label: 'Simulação' },
    { value: 'negociacao', label: 'Negociação' },
    { value: 'reuniao_agendada', label: 'Reunião Agendada' },
    { value: 'contrato_enviado', label: 'Contrato Enviado' },
    { value: 'ativacao', label: 'Ativação' },
    { value: 'ativo', label: 'Ativo' },
    { value: 'pago', label: 'Pago' },
    { value: 'negocio_perdido', label: 'Negócio Perdido' },
];

// Negócio perdido não é "mais avançado" que um lead ainda em andamento.
const ordemStatus = (s) => (s === 'negocio_perdido' ? -1 : STATUS_LEAD.findIndex(o => o.value === s));

export const rotuloStatus = (s) => STATUS_LEAD.find(o => o.value === s)?.label || s || '';

// Campos de cadastro que o usuário arbitra. `comparar` normaliza para que
// "(31) 99215-0239" e "5531992150239" não apareçam como conflito.
export const CAMPOS_MESCLA = [
    { key: 'name', label: 'Nome' },
    { key: 'phone', label: 'Telefone', comparar: v => normalizePhoneDdi(v) },
    { key: 'email', label: 'E-mail', comparar: v => String(v).trim().toLowerCase() },
    { key: 'cpf_cnpj', label: 'CPF/CNPJ', comparar: v => cleanDigits(String(v)) },
    { key: 'status', label: 'Status' },
    { key: 'originator_id', label: 'Originador' },
    { key: 'cep', label: 'CEP', comparar: v => cleanDigits(String(v)) },
    { key: 'rua', label: 'Rua' },
    { key: 'numero', label: 'Número' },
    { key: 'complemento', label: 'Complemento' },
    { key: 'bairro', label: 'Bairro' },
    { key: 'cidade', label: 'Cidade' },
    { key: 'uf', label: 'UF', comparar: v => String(v).trim().toUpperCase() },
    { key: 'concessionaria', label: 'Concessionária' },
    { key: 'tarifa_concessionaria', label: 'Tarifa', comparar: v => Number(v) },
    { key: 'consumo_kwh', label: 'Consumo (kWh)', comparar: v => Number(v) },
    { key: 'desconto_assinante', label: 'Desconto (%)', comparar: v => Number(v) },
    { key: 'atendente', label: 'Atendente' },
    { key: 'plano_id', label: 'Plano' },
    { key: 'indicador_assinante_id', label: 'Indicado por (assinante)' },
    { key: 'solicitante_assinante_id', label: 'Solicitante (assinante)' },
    { key: 'conta_lida', label: 'Conta de energia lida', comparar: v => v?.numeroUc || JSON.stringify(v) },
];

const NUMERICOS = new Set(['tarifa_concessionaria', 'consumo_kwh', 'desconto_assinante']);

export const vazio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

const mesmoValor = (campo, a, b) => {
    const f = campo.comparar || (v => String(v).trim());
    return f(a) === f(b);
};

// Conflito = os dois têm valor e os valores diferem. Quando só um tem, ele
// entra sozinho; quando são iguais, não há o que escolher.
export function camposEmConflito(atual, outro) {
    return CAMPOS_MESCLA.filter(c =>
        !vazio(atual?.[c.key]) && !vazio(outro?.[c.key]) && !mesmoValor(c, atual[c.key], outro[c.key]));
}

// Campos que só um dos dois tem: entram sem perguntar.
export function camposPreenchidosPeloOutro(atual, outro) {
    return CAMPOS_MESCLA.filter(c => vazio(atual?.[c.key]) && !vazio(outro?.[c.key]));
}

// Escolha inicial: o que está no modal (acabou de ser digitado), exceto o
// status, que fica com o mais avançado — mesclar não deve recuar o funil.
export function escolhasIniciais(atual, outro) {
    const escolhas = {};
    for (const c of camposEmConflito(atual, outro)) {
        escolhas[c.key] = c.key === 'status'
            ? (ordemStatus(outro.status) > ordemStatus(atual.status) ? 'outro' : 'atual')
            : 'atual';
    }
    return escolhas;
}

// Valor final de cada campo, no formato que a RPC grava.
export function montarCamposMesclados(atual, outro, escolhas = {}) {
    const campos = {};
    for (const c of CAMPOS_MESCLA) {
        const a = atual?.[c.key];
        const o = outro?.[c.key];
        let v;
        if (vazio(a)) v = o;
        else if (vazio(o)) v = a;
        else v = escolhas[c.key] === 'outro' ? o : a;
        if (vazio(v)) v = null;
        else if (c.key === 'phone') v = normalizePhoneDdi(v);
        else if (NUMERICOS.has(c.key)) v = Number(v);
        campos[c.key] = v;
    }
    // Tags se somam; não há o que escolher.
    campos.tags = [...new Set([...(atual?.tags || []), ...(outro?.tags || [])])];
    return campos;
}
