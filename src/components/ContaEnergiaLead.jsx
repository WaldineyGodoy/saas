import { useRef, useState } from 'react';
import { FileText, Upload, Link2, AlertTriangle, RefreshCw } from 'lucide-react';
import { parseEnergyBill, contaParaPedido } from '../lib/energyBillParser';
import { parseEnergyBillImage } from '../lib/energyBillImage';
import { useUI } from '../contexts/UIContext';

const LIGACAO = { monofasico: 'Monofásico', bifasico: 'Bifásico', trifasico: 'Trifásico' };

const Linha = ({ rotulo, valor }) => (
    <div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{rotulo}</div>
        <div style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: 600, wordBreak: 'break-word' }}>{valor || '—'}</div>
    </div>
);

/**
 * Conta de energia do lead: a UC lida da conta (PDF ou foto) fica em
 * leads.conta_lida e preenche o cadastro na adesão. Ler a conta não cria UC:
 * ela só nasce quando a adesão é assinada.
 */
export default function ContaEnergiaLead({ lead, contaLida, onLeitura }) {
    const { showAlert } = useUI();
    const inputRef = useRef(null);
    const [lendo, setLendo] = useState(false);
    const pedidoDoApp = Boolean(lead?.solicitante_assinante_id);

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
            console.error('Leitura da conta do lead:', err);
            showAlert(err.message || 'Falha ao ler a conta.', 'error');
        } finally {
            setLendo(false);
        }
    };

    const copiarLink = async () => {
        const link = `${window.location.origin}/contrato?lead_id=${lead.id}`;
        try {
            await navigator.clipboard.writeText(link);
            showAlert('Link de adesão copiado. A UC da conta já vai preenchida.', 'success');
        } catch {
            window.prompt('Copie o link de adesão:', link);
        }
    };

    const end = contaLida?.endereco;

    return (
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h4 style={{ margin: 0, color: '#1e293b', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} style={{ color: '#0ea5e9' }} /> Conta de Energia (UC)
            </h4>

            {pedidoDoApp && (
                <div style={{ display: 'flex', gap: '0.6rem', padding: '0.75rem 0.9rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', color: '#92400e', fontSize: '0.85rem', lineHeight: 1.5 }}>
                    <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>
                        Pedido de nova UC feito pelo app por um <b>assinante existente</b>. A adesão pelo link não se aplica
                        (o CPF/CNPJ já tem assinatura): a UC nova depende de termo aditivo, que ainda não existe no sistema.
                    </span>
                </div>
            )}

            {contaLida ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
                    <Linha rotulo="Número da UC" valor={contaLida.numeroUc} />
                    <Linha rotulo="Referência da conta" valor={contaLida.mesReferencia} />
                    <div style={{ gridColumn: '1 / -1' }}><Linha rotulo="Titular na conta" valor={contaLida.titular} /></div>
                    <Linha rotulo="Documento" valor={[contaLida.documentoTipo, contaLida.documento].filter(Boolean).join(' ')} />
                    <Linha rotulo="Classificação" valor={contaLida.classificacao} />
                    <div style={{ gridColumn: '1 / -1' }}><Linha rotulo="Endereço da UC" valor={end?.completo} /></div>
                    <Linha rotulo="Ligação" valor={LIGACAO[contaLida.ligacao] || contaLida.tipoFornecimento} />
                    <Linha rotulo="Consumo médio" valor={contaLida.mediaKwh ? `${contaLida.mediaKwh} kWh` : ''} />
                </div>
            ) : (
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
                    Nenhuma conta lida. Envie o PDF ou uma foto da conta de energia: os dados da UC vão para a adesão,
                    sem precisar redigitar.
                </p>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <input ref={inputRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={ler} />
                <button
                    type="button"
                    disabled={lendo}
                    onClick={() => inputRef.current?.click()}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: lendo ? 'wait' : 'pointer' }}
                >
                    {lendo ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                    {lendo ? 'Lendo a conta...' : contaLida ? 'Ler outra conta' : 'Ler conta (PDF ou foto)'}
                </button>
                {lead?.id && contaLida && !pedidoDoApp && (
                    <button
                        type="button"
                        onClick={copiarLink}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem', background: 'white', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                    >
                        <Link2 size={16} /> Copiar link de adesão
                    </button>
                )}
            </div>
            {!lead?.id && contaLida && (
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Salve o lead para gerar o link de adesão.</p>
            )}
        </div>
    );
}
