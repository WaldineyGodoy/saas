/**
 * Qual UC define o Termo de Adesao do assinante, e o que avisar antes de enviar.
 *
 * O termo imprime UM percentual de desconto, UMA distribuidora e UM vencimento,
 * todos lidos da "primeira UC". Antes, essa primeira era `consumerUnits[0]` de
 * uma consulta SEM ordenacao: com duas UCs de planos diferentes, o contrato
 * saia com o desconto de qualquer uma delas, e podia mudar entre uma abertura
 * do modal e outra. E sem nenhuma UC, o texto saia com 20% e "sua distribuidora
 * local" como se fosse definitivo -- um desconto que ninguem escolheu.
 *
 * Aqui a escolha e deterministica (a UC vigente mais antiga, mesma regra com
 * que a adesao publica liga o indicador a "primeira UC") e as situacoes
 * duvidosas viram aviso, ou bloqueio quando o termo sairia com um valor
 * padrao no lugar de um desconto de verdade.
 */

/** UC que saiu da base nao define contrato e nao aparece nele. */
export const STATUS_UC_ENCERRADA = ['cancelado', 'cancelado_inadimplente', 'desconectado', 'desligado_por_tt'];

const paraNumero = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

/**
 * Percentual que o termo imprime para a UC: o gravado nela e, na falta dele, o
 * do plano. Zero ou vazio nao contam -- com `??` um 0 na UC passava por valor e
 * o termo caia no padrao de 20% mesmo com plano de 15% ligado a ela.
 * Devolve `null` quando nao ha desconto de verdade; nunca inventa um numero.
 */
export const descontoDaUc = (uc) => {
    const daUc = paraNumero(uc?.desconto_assinante);
    if (daUc && daUc > 0) return daUc;
    const doPlano = paraNumero(uc?.planos_assinatura_energia?.desconto_assinante);
    if (doPlano && doPlano > 0) return doPlano;
    return null;
};

const tempo = (uc) => {
    const t = uc?.created_at ? Date.parse(uc.created_at) : NaN;
    return Number.isFinite(t) ? t : Infinity;   // sem data vai para o fim
};

/**
 * UCs vigentes, da mais antiga para a mais nova; empate resolvido pelo id para
 * a ordem ser sempre a mesma. A primeira da lista e a que define o termo.
 * Nao altera a lista recebida.
 */
export function ucsParaContrato(ucs) {
    if (!Array.isArray(ucs)) return [];
    return ucs
        .filter((u) => u && !STATUS_UC_ENCERRADA.includes(u.status))
        .slice()
        .sort((a, b) => (tempo(a) - tempo(b)) || String(a.id).localeCompare(String(b.id)));
}

const pct = (n) => `${String(n).replace('.', ',')}%`;

/**
 * Avisos da aba Contratos. `gravidade`:
 *   'bloqueia' -> o termo sairia com um valor padrao no lugar de um desconto
 *                 escolhido; o envio fica travado ate a UC ser corrigida;
 *   'atencao'  -> o termo sai, mas a equipe precisa saber o que ele diz.
 * Bloqueios vem primeiro.
 */
export function avisosDoContrato(ucs) {
    const vigentes = ucsParaContrato(ucs);
    const avisos = [];

    if (vigentes.length === 0) {
        avisos.push({
            codigo: 'sem_uc',
            gravidade: 'bloqueia',
            mensagem: 'Nenhuma UC ativa cadastrada. Sem UC, o termo sairia com o desconto padrão de 20% e a distribuidora genérica, como se fossem definitivos. Cadastre a UC e o plano na aba Unidades Consumidoras antes de enviar.'
        });
        return avisos;
    }

    const primeira = vigentes[0];
    const descontoPrimeira = descontoDaUc(primeira);
    // "UC 7001" quando ha numero; sem ele, "a UC" -- nunca "UC  " com buraco.
    const nomeDaPrimeira = primeira.numero_uc ? `UC ${primeira.numero_uc}` : 'a UC';

    if (descontoPrimeira === null) {
        avisos.push({
            codigo: 'sem_desconto',
            gravidade: 'bloqueia',
            mensagem: `${nomeDaPrimeira.replace(/^a /, 'A ').replace(/^UC/, 'A UC')} não tem desconto nem plano definido: o termo sairia com o padrão de 20%, que ninguém escolheu. Defina o plano da UC na aba Unidades Consumidoras.`
        });
    }

    // UC e plano discordam (ex.: UC gravada com 20% e plano de 15%). O termo le a
    // UC, e a cobranca tambem: se um dos dois esta errado, o erro vai para o
    // contrato assinado. Zero ou vazio na UC nao conta: ai o termo ja usa o plano.
    const divergentes = vigentes.filter((u) => {
        const daUc = paraNumero(u.desconto_assinante);
        const doPlano = paraNumero(u.planos_assinatura_energia?.desconto_assinante);
        return daUc > 0 && doPlano > 0 && daUc !== doPlano;
    });
    if (divergentes.length > 0) {
        const detalhe = divergentes.map((u) => {
            const plano = u.planos_assinatura_energia?.nome || 'plano';
            return `UC ${u.numero_uc || '?'}: ${pct(paraNumero(u.desconto_assinante))} gravado na UC, mas o ${plano} é de ${pct(paraNumero(u.planos_assinatura_energia.desconto_assinante))}`;
        }).join('; ');
        avisos.push({
            codigo: 'desconto_diverge_plano',
            gravidade: 'bloqueia',
            mensagem: `O desconto da UC não bate com o do plano (${detalhe}). O termo usa o da UC. Abra a UC e salve de novo para herdar o desconto do plano, ou confirme qual dos dois está certo antes de enviar.`
        });
    }

    const distintos = [...new Set(vigentes.map(descontoDaUc).filter((d) => d !== null))];
    if (distintos.length > 1) {
        const porUc = vigentes.map((u) => `UC ${u.numero_uc || '?'}: ${descontoDaUc(u) === null ? 'sem desconto' : pct(descontoDaUc(u))}`).join('; ');
        avisos.push({
            codigo: 'descontos_diferentes',
            gravidade: 'atencao',
            mensagem: `As UCs têm descontos diferentes (${porUc}). O termo mostra um só percentual, o da UC mais antiga (UC ${primeira.numero_uc || '?'}${descontoPrimeira === null ? '' : `, ${pct(descontoPrimeira)}`}). Se cada UC precisa do seu, ajuste a minuta antes de enviar.`
        });
    }

    if (!String(primeira.concessionaria || '').trim()) {
        avisos.push({
            codigo: 'sem_concessionaria',
            gravidade: 'atencao',
            mensagem: `${nomeDaPrimeira.replace(/^a /, 'A ').replace(/^UC/, 'A UC')} não tem concessionária: a cláusula 1 sairá com "sua distribuidora local".`
        });
    }

    return avisos.sort((a, b) => (a.gravidade === 'bloqueia' ? 0 : 1) - (b.gravidade === 'bloqueia' ? 0 : 1));
}

export const contratoBloqueado = (avisos) => Array.isArray(avisos) && avisos.some((a) => a?.gravidade === 'bloqueia');
