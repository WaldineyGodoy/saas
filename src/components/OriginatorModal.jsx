
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep } from '../lib/api';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone, cleanDigits } from '../lib/validators';

export default function OriginatorModal({ originator, onClose, onSave, onDelete }) {
    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        cpf_cnpj: '',
        email: '',
        phone: '',
        pix_key: '',
        pix_key_type: 'cpf', // Default
        split_start: 0,
        split_recurrent: 0,
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: ''
    });

    useEffect(() => {
        if (originator) {
            setFormData({
                name: originator.name || '',
                cpf_cnpj: originator.cpf_cnpj || '',
                email: originator.email || '',
                phone: originator.phone || '',
                pix_key: originator.pix_key || '',
                pix_key_type: originator.pix_key_type || 'cpf',
                split_start: originator.split_commission?.start || 0,
                split_recurrent: originator.split_commission?.recurrent || 0,
                cep: originator.address?.cep || '',
                rua: originator.address?.rua || '',
                numero: originator.address?.numero || '',
                complemento: originator.address?.complemento || '',
                bairro: originator.address?.bairro || '',
                cidade: originator.address?.cidade || '',
                uf: originator.address?.uf || ''
            });
        }
    }, [originator]);

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
                    uf: addr.uf || ''
                }));
            } catch (error) {
                console.error('Erro CEP', error);
                alert('Erro ao buscar CEP');
            } finally {
                setSearchingCep(false);
            }
        }
    };

    // Auto-sync Pix Key
    useEffect(() => {
        if (formData.pix_key_type === 'aleatoria') return; // Don't overwrite if random

        let newVal = '';
        if (formData.pix_key_type === 'cpf') newVal = formData.cpf_cnpj;
        else if (formData.pix_key_type === 'cnpj') newVal = formData.cpf_cnpj; // Assuming same field
        else if (formData.pix_key_type === 'email') newVal = formData.email;
        else if (formData.pix_key_type === 'telefone') newVal = formData.phone;

        if (newVal !== formData.pix_key) {
            setFormData(prev => ({ ...prev, pix_key: newVal }));
        }
    }, [formData.pix_key_type, formData.cpf_cnpj, formData.email, formData.phone]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Validations
        if (!validateDocument(formData.cpf_cnpj)) {
            alert('CPF ou CNPJ inválido! Verifique o número digitado.');
            return;
        }

        if (!validatePhone(formData.phone)) {
            alert('Telefone inválido! Digite o DDD + 9 dígitos. Ex: (11) 99999-9999');
            return;
        }

        setLoading(true);

        const payload = {
            name: formData.name,
            cpf_cnpj: formData.cpf_cnpj,
            email: formData.email,
            phone: formData.phone,
            pix_key: formData.pix_key,
            pix_key_type: formData.pix_key_type,
            split_commission: {
                start: Number(formData.split_start) || 0,
                recurrent: Number(formData.split_recurrent) || 0
            },
            address: {
                cep: formData.cep,
                rua: formData.rua,
                numero: formData.numero,
                complemento: formData.complemento,
                bairro: formData.bairro,
                cidade: formData.cidade,
                uf: formData.uf
            }
        };

        try {
            let result;
            if (originator?.id) {
                result = await supabase.from('originators_v2').update(payload).eq('id', originator.id).select().single();
            } else {
                result = await supabase.from('originators_v2').insert(payload).select().single();
            }

            if (result.error) throw result.error;
            onSave(result.data);
            onClose();
        } catch (error) {
            alert('Erro ao salvar originador: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Excluir este originador?')) return;
        setLoading(true);
        try {
            const { error } = await supabase.from('originators_v2').delete().eq('id', originator.id);
            if (error) throw error;
            if (onDelete) onDelete(originator.id);
            onClose();
        } catch (error) {
            alert('Erro ao excluir: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const referralUrl = originator ? `https://b2wenergia.com.br/convite?name=${encodeURIComponent(originator.name)}&id=${originator.id}` : 'Salve para gerar URL';

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '800px' }}>
                <div className="modal-header">
                    <h2 style={{ fontSize: '1.25rem' }}>{originator ? 'Editar Originador' : 'Novo Originador'}</h2>
                    <button onClick={onClose} className="modal-close">&times;</button>
                </div>

                {originator?.id && (
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#e0f2fe', borderRadius: 'var(--radius-md)', border: '1px solid #bae6fd' }}>
                        <label className="label" style={{ color: '#0369a1' }}>URL de Indicação</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                                value={`https://b2wenergia.com.br/convite?name=${encodeURIComponent(originator.name)}&id=${originator.id}`}
                                className="input"
                                style={{ color: '#0284c7' }}
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    navigator.clipboard.writeText(`https://b2wenergia.com.br/convite?name=${encodeURIComponent(originator.name)}&id=${originator.id}`);
                                    alert('Link copiado!');
                                }}
                                className="btn"
                                style={{ background: '#0ea5e9', color: 'white' }}
                            >
                                Copiar
                            </button>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

                    <div style={{ gridColumn: '1 / -1' }}>
                        <h3 style={{ fontSize: '1rem', color: 'var(--color-text-medium)', marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>Dados Pessoais</h3>
                    </div>

                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label className="label">Nome Completo</label>
                        <input
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            className="input"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">CPF/CNPJ</label>
                        <input
                            value={formData.cpf_cnpj}
                            onChange={e => setFormData({ ...formData, cpf_cnpj: maskCpfCnpj(e.target.value) })}
                            placeholder="000.000.000-00"
                            className="input"
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">Email</label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            className="input"
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">Telefone</label>
                        <input
                            value={formData.phone}
                            onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                            placeholder="(00) 00000-0000"
                            className="input"
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">Tipo Chave PIX</label>
                        <select
                            value={formData.pix_key_type}
                            onChange={e => setFormData({ ...formData, pix_key_type: e.target.value })}
                            className="select"
                        >
                            <option value="cpf">CPF</option>
                            <option value="cnpj">CNPJ</option>
                            <option value="email">Email</option>
                            <option value="telefone">Telefone</option>
                            <option value="aleatoria">Aleatória</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label className="label">Chave PIX</label>
                        <input
                            value={formData.pix_key}
                            onChange={e => setFormData({ ...formData, pix_key: e.target.value })}
                            className="input"
                        />
                    </div>

                    <div style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
                        <h3 style={{ fontSize: '1rem', color: 'var(--color-text-medium)', marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>Endereço</h3>
                    </div>

                    <div className="form-group">
                        <label className="label">CEP</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                value={formData.cep}
                                onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                onBlur={handleCepBlur}
                                placeholder="00000-000"
                                className="input"
                            />
                            {searchingCep && <span style={{ position: 'absolute', right: '10px', top: '10px', fontSize: '0.7rem', color: 'var(--color-text-light)' }}>...</span>}
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="label">Rua</label>
                        <input
                            value={formData.rua}
                            onChange={e => setFormData({ ...formData, rua: e.target.value })}
                            className="input"
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">Número</label>
                        <input
                            value={formData.numero}
                            onChange={e => setFormData({ ...formData, numero: e.target.value })}
                            className="input"
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">Complemento</label>
                        <input
                            value={formData.complemento}
                            onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                            className="input"
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">Bairro</label>
                        <input
                            value={formData.bairro}
                            onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                            className="input"
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">Cidade</label>
                        <input
                            value={formData.cidade}
                            onChange={e => setFormData({ ...formData, cidade: e.target.value })}
                            className="input"
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">UF</label>
                        <input
                            value={formData.uf}
                            onChange={e => setFormData({ ...formData, uf: e.target.value })}
                            className="input"
                        />
                    </div>

                    <div style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
                        <h3 style={{ fontSize: '1rem', color: 'var(--color-text-medium)', marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>Split de Comissão (%)</h3>
                    </div>

                    <div className="form-group">
                        <label className="label">Start (Primeira Fatura)</label>
                        <input
                            type="number" step="0.01"
                            value={formData.split_start}
                            onChange={e => setFormData({ ...formData, split_start: e.target.value })}
                            className="input"
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">Recorrente (Mensal)</label>
                        <input
                            type="number" step="0.01"
                            value={formData.split_recurrent}
                            onChange={e => setFormData({ ...formData, split_recurrent: e.target.value })}
                            className="input"
                        />
                    </div>

                    {originator && (
                        <div style={{ gridColumn: '1 / -1', marginTop: '1rem', padding: '1rem', background: '#ecfdf5', borderRadius: 'var(--radius-md)', border: '1px solid #a7f3d0' }}>
                            <label className="label" style={{ color: '#047857' }}>URL de Indicação</label>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <input
                                    readOnly
                                    value={referralUrl}
                                    className="input"
                                    style={{ border: '1px solid #10b981' }}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(referralUrl);
                                        alert('Link copiado: ' + referralUrl);
                                    }}
                                    className="btn"
                                    style={{ background: '#10b981', color: 'white' }}
                                >
                                    Copiar
                                </button>
                            </div>
                        </div>
                    )}


                    <div className="modal-footer" style={{ gridColumn: '1 / -1' }}>
                        {originator && onDelete && (
                            <button type="button" onClick={handleDelete} className="btn btn-danger" style={{ marginRight: 'auto' }}>
                                Excluir
                            </button>
                        )}
                        <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
                        <button type="submit" disabled={loading} className="btn btn-primary">
                            {loading ? 'Salvando...' : 'Salvar Originador'}
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
}
