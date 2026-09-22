import { useState } from 'react';
import { fetchAddressByCep } from '../lib/api';
import { useUI } from '../contexts/UIContext';
import { maskCpfCnpj, validateDocument } from '../lib/validators';
import { ChevronDown, ChevronUp } from 'lucide-react';

const maskCEP = (val) => (val || '').replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').substring(0, 9);

const CollapsibleSection = ({ title, children, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div style={{
            gridColumn: '1 / -1',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
            marginBottom: '1rem'
        }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    background: 'var(--color-bg-light)',
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontWeight: 600,
                    color: 'var(--color-text)'
                }}
            >
                <span>{title}</span>
                {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
            {isOpen && (
                <div style={{
                    padding: '1rem',
                    borderTop: '1px solid var(--color-border)',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1rem'
                }}>
                    {children}
                </div>
            )}
        </div>
    );
};

/**
 * Coleta os dados de uma UC no fluxo público de adesão.
 *
 * Não grava nada: devolve o objeto por `onSave` e quem persiste é a RPC
 * `fn_criar_assinante_publico`, junto com o assinante, numa transação só.
 * A versão anterior fazia INSERT direto em `consumer_units` — bloqueado por
 * RLS para visitante anônimo, e que exigia gravar o assinante antes.
 */
export default function PublicConsumerUnitForm({
    concessionariaDefault,
    titularDefault,
    franquiaDefault,
    enderecoDefault,
    docAssinante,
    onClose,
    onSave
}) {
    const { showAlert } = useUI();
    const [searchingCep, setSearchingCep] = useState(false);

    const [formData, setFormData] = useState({
        numero_uc: '',
        titular_conta: titularDefault || '',
        concessionaria: concessionariaDefault || '',
        franquia: franquiaDefault || '',
        // Documento de quem aparece na fatura. Quase sempre é o do próprio
        // assinante, por isso já vem preenchido — mas pode ser outro titular.
        cpf_cnpj_fatura: maskCpfCnpj(docAssinante || ''),
        tipo_ligacao: '',

        // Endereço herdado do cadastro do assinante — na maioria das adesões
        // a UC fica no mesmo endereço, e redigitar é onde o cliente desiste.
        cep: maskCEP(enderecoDefault?.cep || ''),
        rua: enderecoDefault?.rua || '',
        numero: enderecoDefault?.numero || '',
        complemento: enderecoDefault?.complemento || '',
        bairro: enderecoDefault?.bairro || '',
        cidade: enderecoDefault?.cidade || '',
        uf: enderecoDefault?.uf || '',
        // Código IBGE do município: é por ele que a RPC acha o desconto.
        ibge: enderecoDefault?.ibge || ''
    });

    const handleCepChange = (e) => {
        const masked = maskCEP(e.target.value);
        // CEP novo invalida o IBGE antigo; o blur busca o certo.
        setFormData(prev => ({ ...prev, cep: masked, ibge: prev.cep === masked ? prev.ibge : '' }));
    };

    const handleCepBlur = async () => {
        const rawCep = formData.cep.replace(/\D/g, '');
        if (rawCep.length === 8) {
            setSearchingCep(true);
            try {
                const addr = await fetchAddressByCep(rawCep);
                setFormData(prev => ({
                    ...prev,
                    rua: addr.rua || '',
                    bairro: addr.bairro || '',
                    cidade: addr.cidade || '',
                    uf: addr.uf || '',
                    ibge: addr.ibge || '',
                }));
            } catch (error) {
                console.error('Erro CEP', error);
                setFormData(prev => ({ ...prev, ibge: '' }));
            } finally {
                setSearchingCep(false);
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        const numeroUc = formData.numero_uc.trim();
        if (!numeroUc) return showAlert('Número da UC é obrigatório.', 'warning');
        if (!formData.titular_conta.trim()) {
            return showAlert('Informe o titular da conta, exatamente como aparece na fatura.', 'warning');
        }

        if (!validateDocument(formData.cpf_cnpj_fatura)) {
            return showAlert('Informe um CPF/CNPJ válido do titular da conta.', 'warning');
        }
        if (!['monofasico', 'bifasico', 'trifasico'].includes(formData.tipo_ligacao)) {
            return showAlert('Informe o tipo de ligação (está na sua conta de luz).', 'warning');
        }

        // Sem IBGE a RPC não acha o desconto do município. Se o blur do CEP
        // não chegou a rodar (ou falhou), tenta mais uma vez aqui.
        let ibge = formData.ibge;
        if (!ibge) {
            try {
                ibge = (await fetchAddressByCep(formData.cep || '')).ibge || '';
            } catch {
                ibge = '';
            }
        }
        if (!ibge) return showAlert('Não conseguimos localizar o CEP da instalação. Confira o CEP.', 'warning');

        onSave({
            ...formData,
            ibge,
            numero_uc: numeroUc,
            cpf_cnpj_fatura: formData.cpf_cnpj_fatura.replace(/\D/g, '')
        });
        onClose();
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '600px' }}>
                <div className="modal-header">
                    <h3>Nova Unidade Consumidora</h3>
                    {/* Sem `type="button"` o padrão dentro de <form> é submit:
                        o "×" adicionava a UC em vez de fechar o modal. */}
                    <button type="button" onClick={onClose} className="modal-close">&times;</button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

                    {/* Unit Data - Top Priority */}
                    <div style={{ gridColumn: '1 / -1', background: '#f0f9ff', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid #bae6fd' }}>
                        <div style={{ marginBottom: '1rem' }}>
                            <label className="label">Número da UC <span style={{ color: 'var(--color-error)' }}>*</span></label>
                            <input
                                required
                                value={formData.numero_uc}
                                onChange={e => setFormData({ ...formData, numero_uc: e.target.value })}
                                placeholder="Ex: 7204400277"
                                className="input"
                                style={{ fontSize: '1.1rem', fontWeight: 'bold' }}
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label className="label">Titular da Conta (Conforme Fatura)</label>
                            <input
                                required
                                value={formData.titular_conta}
                                onChange={e => setFormData({ ...formData, titular_conta: e.target.value })}
                                placeholder="Nome Completo / Razão Social"
                                className="input"
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label className="label">CPF/CNPJ do titular da conta <span style={{ color: 'var(--color-error)' }}>*</span></label>
                            <input
                                required
                                inputMode="numeric"
                                value={formData.cpf_cnpj_fatura}
                                onChange={e => setFormData({ ...formData, cpf_cnpj_fatura: maskCpfCnpj(e.target.value) })}
                                placeholder="000.000.000-00"
                                className="input"
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label className="label">Tipo de ligação <span style={{ color: 'var(--color-error)' }}>*</span></label>
                            <select
                                required
                                value={formData.tipo_ligacao}
                                onChange={e => setFormData({ ...formData, tipo_ligacao: e.target.value })}
                                className="input"
                            >
                                <option value="">Selecione</option>
                                <option value="monofasico">Monofásico</option>
                                <option value="bifasico">Bifásico</option>
                                <option value="trifasico">Trifásico</option>
                            </select>
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label className="label">Consumo médio mensal (kWh)</label>
                            <input
                                type="number"
                                min="0"
                                value={formData.franquia}
                                onChange={e => setFormData({ ...formData, franquia: e.target.value })}
                                placeholder="Ex: 500"
                                className="input"
                            />
                            <small style={{ color: 'var(--color-text-medium)' }}>
                                Está na sua conta de luz, no histórico de consumo. É o que dimensiona sua economia.
                            </small>
                        </div>

                        <div>
                            <label className="label">Concessionária</label>
                            {/* Editável quando a simulação não identificou a distribuidora —
                                antes o campo ficava travado e vazio, e a UC nascia sem concessionária. */}
                            <input
                                value={formData.concessionaria}
                                onChange={e => setFormData({ ...formData, concessionaria: e.target.value })}
                                readOnly={!!concessionariaDefault}
                                placeholder="Ex: COSERN"
                                className="input"
                                style={concessionariaDefault ? { background: '#e0e0e0', color: '#555' } : undefined}
                            />
                        </div>
                    </div>

                    {/* Address Section */}
                    <CollapsibleSection title="Endereço de Instalação" defaultOpen={true}>
                        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '1rem' }}>
                            <div style={{ width: '140px' }}>
                                <label className="label">CEP</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        value={formData.cep}
                                        onChange={handleCepChange}
                                        onBlur={handleCepBlur}
                                        placeholder="00000-000"
                                        maxLength={9}
                                        className="input"
                                    />
                                    {searchingCep && <span style={{ position: 'absolute', right: '10px', top: '10px', fontSize: '0.7rem' }}>...</span>}
                                </div>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label className="label">Rua</label>
                                <input
                                    value={formData.rua}
                                    onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                    className="input"
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', gridColumn: '1 / -1' }}>
                            <div style={{ width: '100px' }}>
                                <label className="label">Número</label>
                                <input
                                    value={formData.numero}
                                    onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                    className="input"
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label className="label">Bairro</label>
                                <input
                                    value={formData.bairro}
                                    onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                    className="input"
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', gridColumn: '1 / -1' }}>
                            <div style={{ flex: 1 }}>
                                <label className="label">Complemento</label>
                                <input
                                    value={formData.complemento}
                                    onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                    className="input"
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', gridColumn: '1 / -1' }}>
                            <div style={{ flex: 1 }}>
                                <label className="label">Cidade</label>
                                <input
                                    value={formData.cidade}
                                    readOnly
                                    className="input"
                                    style={{ background: '#f5f5f5' }}
                                />
                            </div>
                            <div style={{ width: '60px' }}>
                                <label className="label">UF</label>
                                <input
                                    value={formData.uf}
                                    readOnly
                                    className="input"
                                    style={{ background: '#f5f5f5' }}
                                />
                            </div>
                        </div>
                    </CollapsibleSection>

                    <div className="modal-footer" style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
                        <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
                        <button type="submit" className="btn btn-primary" style={{ minWidth: '150px' }}>
                            Adicionar UC
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
}
