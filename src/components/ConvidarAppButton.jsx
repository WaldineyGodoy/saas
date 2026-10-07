import { useState } from 'react';
import { Smartphone, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';

/**
 * Envia por WhatsApp o convite para o app (edge function convidar-app): cria
 * o login se faltar e manda o link de criar senha.
 */
export default function ConvidarAppButton({ tipo, id, nome, style }) {
    const { showAlert, showConfirm } = useUI();
    const [enviando, setEnviando] = useState(false);

    const convidar = async () => {
        const ok = await showConfirm(
            `Enviar para ${nome || 'este cadastro'} o convite do app por WhatsApp, com o link para criar a senha?`,
            'Convidar para o app'
        );
        if (!ok) return;

        setEnviando(true);
        try {
            const { data, error } = await supabase.functions.invoke('convidar-app', { body: { tipo, id } });
            if (error) {
                // Em resposta nao-2xx o corpo com a mensagem fica em error.context.
                const corpo = await error.context?.json?.().catch(() => null);
                throw new Error(corpo?.error || error.message);
            }
            showAlert(
                data?.criado
                    ? `Convite enviado. Login criado para ${data.email}.`
                    : `Convite enviado para o login ${data?.email}.`,
                'success'
            );
        } catch (e) {
            showAlert('Convite não enviado: ' + e.message, 'error');
        } finally {
            setEnviando(false);
        }
    };

    return (
        <button
            type="button"
            onClick={convidar}
            disabled={enviando}
            title="Enviar convite do app por WhatsApp"
            style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center',
                padding: '0.6rem 1.25rem', background: '#ecfdf5', color: '#047857',
                border: '1px solid #a7f3d0', borderRadius: '6px', fontWeight: 600,
                cursor: enviando ? 'wait' : 'pointer',
                ...style
            }}
        >
            {enviando ? <Loader2 size={16} className="animate-spin" /> : <Smartphone size={16} />}
            {enviando ? 'Enviando...' : 'Convidar para o app'}
        </button>
    );
}
