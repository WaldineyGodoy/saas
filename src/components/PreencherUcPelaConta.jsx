import { useRef, useState } from 'react';
import { FileText, RefreshCw, Upload } from 'lucide-react';
import { parseEnergyBill, contaParaPedido } from '../lib/energyBillParser';
import { parseEnergyBillImage } from '../lib/energyBillImage';
import { useUI } from '../contexts/UIContext';

/**
 * Atalho da equipe ao cadastrar UC nova para assinante existente: lê a conta
 * (PDF ou foto) e devolve os dados para o modal preencher o formulário. Não
 * grava nada nem cria lead -- quem salva é o próprio modal, depois de conferir.
 */
export default function PreencherUcPelaConta({ onLeitura }) {
    const { showAlert } = useUI();
    const inputRef = useRef(null);
    const [lendo, setLendo] = useState(false);

    const ler = async (e) => {
        const arquivo = e.target.files?.[0];
        e.target.value = '';
        if (!arquivo) return;
        const ehPdf = arquivo.type === 'application/pdf';
        if (!ehPdf && !arquivo.type.startsWith('image/')) {
            showAlert('Selecione o PDF ou uma foto da conta.', 'error');
            return;
        }
        setLendo(true);
        try {
            const leitura = ehPdf ? await parseEnergyBill(arquivo) : await parseEnergyBillImage(arquivo);
            if (!leitura.numeroUc) throw new Error('Não encontrei o número da UC nesta conta.');
            await onLeitura(contaParaPedido(leitura));
        } catch (err) {
            console.error('Leitura da conta na nova UC:', err);
            showAlert(err.message || 'Falha ao ler a conta.', 'error');
        } finally {
            setLendo(false);
        }
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '1rem 1.25rem', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '12px' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <FileText size={20} style={{ color: '#0ea5e9', flexShrink: 0, marginTop: 2 }} />
                <div>
                    <div style={{ fontWeight: 600, color: '#0c4a6e', fontSize: '0.9rem' }}>Preencher pela conta de energia</div>
                    <div style={{ color: '#0369a1', fontSize: '0.8rem' }}>
                        Envie o PDF ou uma foto da conta: número da UC, titular, ligação, endereço e consumo médio são preenchidos. Confira antes de salvar.
                    </div>
                </div>
            </div>
            <input ref={inputRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={ler} />
            <button
                type="button"
                disabled={lendo}
                onClick={() => inputRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: lendo ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
            >
                {lendo ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                {lendo ? 'Lendo a conta...' : 'Ler conta (PDF ou foto)'}
            </button>
        </div>
    );
}
