import React from 'react';
import { IdCard, RefreshCw, Upload, Paperclip } from 'lucide-react';

/**
 * Parte visual da leitura de CNH/RG no topo de "Dados Cadastrais e Contato".
 * Separada do contêiner (que fala com a Edge Function) para renderizar em teste.
 *
 * `avisos`: o que a leitura não conseguiu preencher ou achou divergente.
 * `arquivoNome`: arquivo já lido, que será anexado ao salvar o assinante.
 */
export default function PainelLerDocumentoIdentidade({ lendo = false, arquivoNome = '', avisos = [], onEscolher, inputRef, onArquivo }) {
    return (
        <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '0.85rem 1rem', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '12px' }}>
                <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start', flex: '1 1 260px' }}>
                    <IdCard size={20} style={{ color: '#0ea5e9', flexShrink: 0, marginTop: 2 }} />
                    <div style={{ color: '#0c4a6e', fontSize: '0.84rem', fontWeight: 600, lineHeight: 1.4 }}>
                        Informe o CPF ou faça o upload do documento de identificação (para fazer a leitura do documento e preencher os dados)
                    </div>
                </div>
                <input ref={inputRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={onArquivo} />
                <button
                    type="button"
                    disabled={lendo}
                    onClick={onEscolher}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.95rem', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.82rem', cursor: lendo ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
                >
                    {lendo ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                    {lendo ? 'Lendo o documento...' : 'Ler CNH ou RG (foto ou PDF)'}
                </button>
            </div>

            {arquivoNome && !lendo && (
                <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.76rem', color: '#15803d', fontWeight: 600 }}>
                    <Paperclip size={14} /> Documento lido: {arquivoNome}. Confira os dados; o arquivo é anexado ao salvar.
                </div>
            )}
            {avisos.map((aviso) => (
                <div key={aviso} role="alert" style={{ marginTop: '0.35rem', fontSize: '0.76rem', color: '#92400e' }}>{aviso}</div>
            ))}
        </div>
    );
}
