import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useUI } from '../../contexts/UIContext';
import {
    procurarParceiro, dadosParaParceiroPower, podeTrocarPapel, textoConfirmacaoParceiroPower
} from '../../lib/parceiroPower';
import PainelParceiroPower from './PainelParceiroPower';

const COLUNAS = 'id, name, email, cpf_cnpj, cargo, short_url';

const mensagemDeErro = (e) => {
    if (e?.code === '42501') return 'Seu usuário não tem permissão para cadastrar parceiros.';
    if (e?.code === '23505') return 'Já existe um parceiro com este acesso.';
    return e?.message || 'Falha ao cadastrar o parceiro.';
};

/**
 * "Tornar Parceiro Power" no cadastro do assinante: cria o originador a partir dos
 * dados dele, com um clique. As regras (quem já é parceiro, o que falta, o id do
 * login, quem pode trocar papel) estão em lib/parceiroPower.js, testadas à parte.
 *
 * `assinante` é o cadastro GRAVADO, não o formulário: o que vira parceiro é o que
 * está salvo, para os dois registros não divergirem.
 */
export default function TornarParceiroPower({ assinante, papelDeQuemClica, addHistory }) {
    const { showAlert, showConfirm } = useUI();
    const [originadores, setOriginadores] = useState(null);   // null = carregando
    const [ocupado, setOcupado] = useState(false);

    const carregar = useCallback(async () => {
        const { data, error } = await supabase.from('originators_v2').select(COLUNAS);
        if (error) {
            // Sem saber quem já é parceiro, o botão não aparece: oferecer criar agora
            // poderia duplicar o cadastro.
            console.error('Erro ao listar parceiros:', error);
            return null;
        }
        setOriginadores(data || []);
        return data || [];
    }, []);

    useEffect(() => { carregar(); }, [carregar, assinante?.id]);

    const estado = useMemo(() => {
        if (originadores === null) return { tipo: 'carregando' };
        const existente = procurarParceiro(originadores, assinante);
        if (existente) return { tipo: 'parceiro', parceiro: existente };
        const dados = dadosParaParceiroPower(assinante);
        return dados.ok ? { tipo: 'pode' } : { tipo: 'faltam', faltando: dados.faltando };
    }, [originadores, assinante]);

    const copiarLink = async () => {
        const link = estado.parceiro?.short_url;
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            showAlert('Link do parceiro copiado.', 'success');
        } catch {
            showAlert(`Copie o link: ${link}`, 'warning');
        }
    };

    const tornar = async () => {
        const dados = dadosParaParceiroPower(assinante);
        if (!dados.ok) {
            showAlert(`Falta: ${dados.faltando.join(', ')}.`, 'warning');
            return;
        }

        // Lista fresca logo antes de criar: outra pessoa pode ter cadastrado este
        // parceiro depois que o modal abriu.
        const atuais = await carregar();
        if (atuais === null) {
            showAlert('Não foi possível conferir se já é parceiro. Tente de novo.', 'error');
            return;
        }
        if (procurarParceiro(atuais, assinante)) {
            showAlert('Este cadastro já é Parceiro Power.', 'warning');
            return;
        }

        // Já tem login? Então o originador nasce com o id dele (ver parceiroPower.js)
        // e, se for login de assinante, o papel passa a embaixador.
        let perfil = null;
        if (assinante.user_id) {
            const { data } = await supabase.from('profiles').select('id, role').eq('id', assinante.user_id).maybeSingle();
            perfil = data;
        }
        const temLogin = !!assinante.user_id;
        const vaiTrocarPapel = temLogin && podeTrocarPapel(perfil, papelDeQuemClica);

        const ok = await showConfirm(
            textoConfirmacaoParceiroPower({ nome: assinante.name, temLogin, vaiTrocarPapel }),
            'Tornar Parceiro Power', 'Cadastrar', 'Cancelar'
        );
        if (!ok) return;

        setOcupado(true);
        try {
            const { data: novo, error } = await supabase.from('originators_v2').insert(dados.payload).select('id, cargo, short_url').single();
            if (error) throw error;

            let trocouPapel = false;
            if (vaiTrocarPapel) {
                // `.select('id')` porque o banco pode recusar em silêncio (zero linhas),
                // e sem checar isso o aviso de sucesso mentiria.
                const { data: trocados, error: erroPapel } = await supabase
                    .from('profiles').update({ role: 'originator' })
                    .eq('id', assinante.user_id).eq('role', 'subscriber').select('id');
                trocouPapel = !erroPapel && (trocados?.length || 0) > 0;
            }

            await addHistory?.('originator', novo.id, 'originator_created', { origem: 'assinante', subscriber_id: assinante.id },
                `Cadastrado como Parceiro Power a partir do assinante ${assinante.name}`);
            await addHistory?.('subscriber', assinante.id, 'parceiro_power', { originator_id: novo.id },
                'Cadastrado também como Parceiro Power (PPF).');
            await carregar();

            if (!temLogin) {
                showAlert('Parceiro Power cadastrado. Agora clique em "Convidar para o app" para liberar o acesso.', 'success');
            } else if (trocouPapel) {
                showAlert('Parceiro Power cadastrado e papel do login atualizado: a área de embaixador aparece no próximo acesso.', 'success');
            } else {
                showAlert('Parceiro Power cadastrado, mas o papel do login não foi trocado. Peça a um administrador para trocá-lo em Configurações → Perfil de Usuários.', 'warning');
            }
        } catch (e) {
            console.error('Erro ao tornar Parceiro Power:', e);
            showAlert(mensagemDeErro(e), 'error');
        } finally {
            setOcupado(false);
        }
    };

    return <PainelParceiroPower estado={estado} ocupado={ocupado} onClick={tornar} onCopiar={copiarLink} />;
}
