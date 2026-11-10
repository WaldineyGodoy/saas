import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUI } from '../contexts/UIContext';
import { fetchCpfCnpjData, fetchAddressByCep } from '../lib/api';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone, cleanDigits } from '../lib/validators';
import {
    History, User, MapPin, Wallet, X, Save, Trash2,
    CheckCircle, Search, ArrowUpDown, ArrowUpRight, ArrowDownLeft, Copy, Zap, Download,
    Building2, Mail, ChevronDown, ChevronRight, RefreshCw
} from 'lucide-react';
import HistoryTimeline from './HistoryTimeline';
import ConvidarAppButton from './ConvidarAppButton';
import SubscriberModal from './SubscriberModal';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import autoTable from 'jspdf-autotable';

// Rótulos do status calculado. A ordem é a do ciclo do fornecedor.
const STATUS_FORNECEDOR = {
    cadastrado: { rotulo: 'Cadastrado', cor: '#475569', fundo: '#f1f5f9' },
    contrato_assinado: { rotulo: 'Contrato Assinado', cor: '#1e40af', fundo: '#dbeafe' },
    ativacao: { rotulo: 'Em Ativação', cor: '#854d0e', fundo: '#fef9c3' },
    ativo: { rotulo: 'Ativo', cor: '#166534', fundo: '#dcfce7' },
    inativo: { rotulo: 'Inativo', cor: '#991b1b', fundo: '#fee2e2' }
};

export default function SupplierModal({ supplier, onClose, onSave, onDelete }) {
    const { profile } = useAuth();
    const { showAlert, showConfirm } = useUI();
    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);
    const [activeTab, setActiveTab] = useState('geral');
    // Busca pelo CPF/CNPJ: fornecedor repetido bloqueia o cadastro; assinante
    // ou lead do mesmo documento pré-preenchem contato e endereço.
    const [fornecedorDuplicado, setFornecedorDuplicado] = useState(null);
    const [leadHerdado, setLeadHerdado] = useState(null);
    const [origemHerdada, setOrigemHerdada] = useState('');
    // Fornecedor que nasce de um lead sem assinante abre o "Novo Assinante"
    // já preenchido antes de fechar (o titular da UG é sempre assinante).
    const [assinanteDoLead, setAssinanteDoLead] = useState(null);
    const [fornecedorSalvo, setFornecedorSalvo] = useState(null);
    const [usinas, setUsinas] = useState([]);
    const [ledgerEntries, setLedgerEntries] = useState([]);
    const [repasseOrigins, setRepasseOrigins] = useState({});
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [expandedTx, setExpandedTx] = useState(null);
    const [txDetails, setTxDetails] = useState([]);
    const [txLoading, setTxLoading] = useState(false);
    const [paying, setPaying] = useState(false);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState(0);
    const [isPartial, setIsPartial] = useState(false);
    const [pendingBalance, setPendingBalance] = useState(0);

    // Adiantamento: pagamento feito antes de o faturamento existir. Vive na conta
    // 1.1.3 (ativo), nunca em 2.1.1, e e amortizado conforme as faturas sao pagas.
    const [advanceBalance, setAdvanceBalance] = useState(0);
    const [showAdvanceModal, setShowAdvanceModal] = useState(false);
    const [advanceAmount, setAdvanceAmount] = useState('');
    const [advanceReason, setAdvanceReason] = useState('');
    const [advancing, setAdvancing] = useState(false);

    // Extrato Filters
    const [extratoStartDate, setExtratoStartDate] = useState('');
    const [extratoEndDate, setExtratoEndDate] = useState('');
    const [extratoType, setExtratoType] = useState('all');

    // Manual Entry State
    const [manualEntryAmount, setManualEntryAmount] = useState('');
    const [manualEntryType, setManualEntryType] = useState('credit');
    const [manualEntryDescription, setManualEntryDescription] = useState('');
    const [manualEntryLoading, setManualEntryLoading] = useState(false);
    // Contrapartida do lancamento avulso. Sem ela o lancamento saia com uma perna
    // so, e o razao deixava de somar zero — origem do desequilibrio historico.
    const [manualEntryCounterAccount, setManualEntryCounterAccount] = useState('2.1.4');
    const [counterAccounts, setCounterAccounts] = useState([]);

    // Originador que trouxe o fornecedor (spec do plano de usina, decisao
    // 6b): as usinas dele herdam, e o split paga o que o plano de cada uma
    // preve. So admin altera (fn_suppliers_originador_admin).
    const [originadores, setOriginadores] = useState([]);
    useEffect(() => {
        supabase.from('originators_v2').select('id, name, cargo, ativo').order('name')
            .then(({ data, error }) => {
                if (error) console.error('Erro ao carregar originadores:', error);
                else setOriginadores(data || []);
            });
    }, []);
    const ehAdmin = ['admin', 'super_admin'].includes(profile?.role);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    const extratoPrintRef = useRef(null);

    const [formData, setFormData] = useState({
        name: '',
        cnpj: '',
        email: '',
        phone: '',
        status: 'cadastrado',
        contrato_assinado_em: '',
        legal_partner_name: '',
        legal_partner_cpf: '',
        pix_key: '',
        pix_key_type: 'cpf', // Default
        originator_id: '',
        // Address fields
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: ''
    });

    useEffect(() => {
        if (supplier) {
            setFormData({
                name: supplier.name || '',
                cnpj: supplier.cnpj || '',
                email: supplier.email || '',
                phone: supplier.phone || '',
                status: supplier.status || 'cadastrado',
                contrato_assinado_em: supplier.contrato_assinado_em
                    ? supplier.contrato_assinado_em.slice(0, 10) : '',
                legal_partner_name: supplier.legal_partner_name || '',
                legal_partner_cpf: supplier.legal_partner_cpf || '',
                pix_key: supplier.pix_key || '',
                pix_key_type: supplier.pix_key_type || 'cpf',
                originator_id: supplier.originator_id || '',
                cep: supplier.address?.cep || '',
                rua: supplier.address?.logradouro || supplier.address?.rua || '',
                numero: supplier.address?.numero || '',
                complemento: supplier.address?.complemento || '',
                bairro: supplier.address?.bairro || '',
                cidade: supplier.address?.municipio || supplier.address?.cidade || '',
                uf: supplier.address?.uf || ''
            });

            fetchLinkedUsinas(supplier.id);
            fetchLedgerStatement();
        }
    }, [supplier]);

    const fetchLinkedUsinas = async (supplierId) => {
        const { data } = await supabase
            .from('usinas')
            .select('id, name, status')
            .eq('supplier_id', supplierId);

        setUsinas(data || []);
    };

    const fetchLedgerStatement = async () => {
        if (!supplier?.id) return;
        setLedgerLoading(true);
        try {
            // Fetch entries where the supplier is the reference_id and account is 2.1.1
            const { data, error } = await supabase
                .from('view_ledger_enriched')
                .select('*')
                .eq('account_code', '2.1.1')
                .or(`reference_id.eq.${supplier.id},supplier_id.eq.${supplier.id}`)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setLedgerEntries(data || []);

            // Fetch pending transfers to display/retain balance
            const { data: pendingData, error: pendingError } = await supabase
                .from('financial_transfers')
                .select('amount')
                .eq('destination_type', 'supplier')
                .eq('destination_id', supplier.id)
                .eq('status', 'pending');

            if (!pendingError && pendingData) {
                const pendingSum = pendingData.reduce((acc, curr) => acc + Number(curr.amount || 0), 0);
                setPendingBalance(pendingSum);
            } else {
                setPendingBalance(0);
            }

            // Plano de contas para a contrapartida do lancamento avulso.
            const { data: contas } = await supabase
                .from('ledger_accounts')
                .select('code, name, type')
                .neq('code', '2.1.1')
                .order('code');
            setCounterAccounts((contas || []).filter((c) => (c.code.match(/\./g) || []).length >= 2));

            // Adiantamento em aberto (conta 1.1.3). Sem isto o operador ve "saldo zero"
            // e nao sabe que ja pagou adiantado — foi assim que julho/2026 duplicou.
            const { data: advanceData, error: advanceError } = await supabase
                .from('ledger_entries')
                .select('amount, ledger_accounts!inner(code)')
                .eq('ledger_accounts.code', '1.1.3')
                .eq('reference_id', supplier.id);

            if (!advanceError && advanceData) {
                const advSum = advanceData.reduce((acc, curr) => acc + Number(curr.amount || 0), 0);
                setAdvanceBalance(Math.round(advSum * 100) / 100);
            } else {
                setAdvanceBalance(0);
            }

            // Pre-fetch subscriber names for repasse entries
            const repasseTxs = (data || [])
                .filter(e => e.description?.toLowerCase().includes('repasse'))
                .map(e => e.transaction_id);

            if (repasseTxs.length > 0) {
                const originMap = {};

                // Fallback: Fetch basic entity names for older entries that might lack invoice links
                const { data: repasseData } = await supabase
                    .from('view_ledger_enriched')
                    .select('transaction_id, entity_name, account_code')
                    .in('transaction_id', repasseTxs)
                    .in('account_code', ['1.1.2', '4.1.1']);
                
                if (repasseData) {
                    repasseData.forEach(r => {
                        if (r.entity_name) originMap[r.transaction_id] = r.entity_name;
                    });
                }

                // Primary: Fetch rich invoice data for recent/correct entries
                const { data: invoiceEntries } = await supabase
                    .from('ledger_entries')
                    .select('transaction_id, reference_id')
                    .in('transaction_id', repasseTxs)
                    .eq('reference_type', 'invoice');
                
                if (invoiceEntries && invoiceEntries.length > 0) {
                    const invoiceIds = invoiceEntries.map(e => e.reference_id);
                    const { data: invoiceData } = await supabase
                        .from('invoices')
                        .select('id, mes_referencia, consumo_compensado, consumer_units(uc_code, subscribers(name))')
                        .in('id', invoiceIds);
                    
                    if (invoiceData) {
                        const invMap = {};
                        invoiceData.forEach(inv => invMap[inv.id] = inv);

                        invoiceEntries.forEach(entry => {
                            const inv = invMap[entry.reference_id];
                            if (inv) {
                                const subscriberName = inv.consumer_units?.subscribers?.name || originMap[entry.transaction_id] || '';
                                const parts = subscriberName.trim().split(' ');
                                const shortName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
                                const ucCode = inv.consumer_units?.uc_code || '';
                                
                                let refMonth = inv.mes_referencia || '';
                                if (refMonth.includes('-')) {
                                    const [y, m] = refMonth.split('-');
                                    refMonth = `${m}/${y}`;
                                }
                                
                                if (ucCode && refMonth) {
                                    const kwh = inv.consumo_compensado ? ` - ${inv.consumo_compensado} kWh` : '';
                                    originMap[entry.transaction_id] = `${shortName} UC ${ucCode} - Ref: ${refMonth}${kwh}`;
                                }
                            }
                        });
                    }
                }
                setRepasseOrigins(originMap);
            }

        } catch (err) {
            console.error('Error fetching ledger:', err);
        } finally {
            setLedgerLoading(false);
        }
    };

    const [refreshing, setRefreshing] = useState(false);

    const handleRefreshModalData = async () => {
        if (!supplier?.id || refreshing) return;
        setRefreshing(true);
        try {
            const [{ data: freshSupplier }] = await Promise.all([
                supabase.from('suppliers').select('*').eq('id', supplier.id).single(),
                fetchLinkedUsinas(supplier.id),
                fetchLedgerStatement()
            ]);
            if (freshSupplier) {
                setFormData(prev => ({
                    ...prev,
                    status: freshSupplier.status || prev.status,
                    contrato_assinado_em: freshSupplier.contrato_assinado_em
                        ? freshSupplier.contrato_assinado_em.slice(0, 10)
                        : prev.contrato_assinado_em
                }));
            }
            if (expandedTx) {
                const { data: freshTx } = await supabase
                    .from('view_ledger_enriched')
                    .select('*')
                    .eq('transaction_id', expandedTx)
                    .order('amount', { ascending: false });
                if (freshTx) setTxDetails(freshTx);
            }
        } catch (err) {
            console.error('Erro ao atualizar dados do fornecedor:', err);
            showAlert('Erro ao atualizar dados: ' + (err.message || ''), 'error');
        } finally {
            setRefreshing(false);
        }
    };

    const fetchTransactionDetails = async (transactionId) => {
        if (expandedTx === transactionId) {
            setExpandedTx(null);
            return;
        }

        setExpandedTx(transactionId);
        setTxLoading(true);
        try {
            const { data, error } = await supabase
                .from('view_ledger_enriched')
                .select('*')
                .eq('transaction_id', transactionId)
                .order('amount', { ascending: false });

            if (error) throw error;
            setTxDetails(data || []);
        } catch (err) {
            console.error('Error fetching tx details:', err);
        } finally {
            setTxLoading(false);
        }
    };

    const handlePayPix = async () => {
        if (!supplier?.id) return;
        
        const canPay = ['super_admin', 'superadmin', 'admin', 'gerente'].includes(profile?.role);
        if (!canPay) {
            showAlert('Você não tem permissão para realizar pagamentos.', 'error');
            return;
        }

        if (availableBalance <= 0) {
            showAlert('Não há saldo disponível para realizar pagamentos (o saldo atual é negativo ou está totalmente retido em transferências pendentes).', 'warning');
            return;
        }

        if (!formData.pix_key || !formData.pix_key_type) {
            showAlert('Chave PIX não cadastrada para este fornecedor.', 'warning');
            return;
        }

        setPaymentAmount(Math.abs(availableBalance));
        setIsPartial(false);
        setShowPaymentModal(true);
    };

    const confirmPixPayment = async () => {
        const amountToPay = Number(paymentAmount);

        if (amountToPay <= 0) {
            showAlert('O valor do pagamento deve ser maior que zero.', 'warning');
            return;
        }

        if (amountToPay > availableBalance) {
            showAlert('O valor do pagamento não pode ser superior ao saldo disponível.', 'warning');
            return;
        }

        setPaying(true);
        setShowPaymentModal(false);
        
        try {
            const { data, error } = await supabase.functions.invoke('transfer-asaas-pix', {
                body: {
                    amount: amountToPay,
                    value: amountToPay,
                    pixKey: formData.pix_key,
                    pix_key: formData.pix_key,
                    pixKeyType: formData.pix_key_type,
                    pix_key_type: formData.pix_key_type,
                    supplierId: supplier.id,
                    destinationType: 'supplier',
                    description: `Pagamento Fornecedor: ${formData.name}`,
                    operationType: 'PIX'
                }
            });

            if (error) throw error;
            if (data && data.success === false) throw new Error(data.error);

            showAlert('Pagamento PIX solicitado com sucesso! Aguardando confirmação.', 'success');
            
            await addHistory('supplier', supplier.id, 'payment_requested', {
                amount: amountToPay,
                type: 'PIX',
                asaas_id: data?.data?.id
            }, `Solicitado pagamento de ${Math.abs(amountToPay).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} via PIX`);

            // Refresh ledger
            fetchLedgerStatement();
        } catch (err) {
            console.error('Erro no pagamento:', err);
            showAlert('Erro ao processar pagamento: ' + err.message, 'error');
        } finally {
            setPaying(false);
        }
    };

    const podeMoverDinheiro = ['super_admin', 'superadmin', 'admin', 'gerente'].includes(profile?.role);

    /**
     * Adiantamento: paga o fornecedor antes de existir faturamento. Nao depende de
     * saldo — e justamente para quando nao ha. O valor nao pode virar credito em
     * 2.1.1, senao colide com o credito que o trigger da fatura paga lanca depois
     * (foi o que duplicou julho/2026); ele vive em 1.1.3 ate ser amortizado.
     */
    const handleAdvance = () => {
        if (!supplier?.id) {
            showAlert('Salve o fornecedor antes de adiantar valores.', 'warning');
            return;
        }
        if (!podeMoverDinheiro) {
            showAlert('Você não tem permissão para realizar pagamentos.', 'error');
            return;
        }
        if (!formData.pix_key || !formData.pix_key_type) {
            showAlert('Chave PIX não cadastrada para este fornecedor.', 'warning');
            return;
        }
        setAdvanceAmount('');
        setAdvanceReason('');
        setShowAdvanceModal(true);
    };

    /** Move para 1.1.3 qualquer pagamento que tenha passado do saldo devido. */
    const classificarAdiantamento = async () => {
        const { data, error } = await supabase
            .rpc('classificar_adiantamento', { p_supplier_id: supplier.id });
        if (error) throw new Error(error.message);
        if (data && data.ok === false) throw new Error(data.motivo || 'falha ao classificar');
        return data;
    };

    const confirmAdvance = async () => {
        const valor = Number(advanceAmount);

        if (!valor || isNaN(valor) || valor <= 0) {
            showAlert('Informe um valor válido para o adiantamento.', 'warning');
            return;
        }
        if (!advanceReason.trim()) {
            showAlert('Descreva o motivo do adiantamento — ele fica no extrato.', 'warning');
            return;
        }

        setAdvancing(true);
        setShowAdvanceModal(false);

        try {
            const { data, error } = await supabase.functions.invoke('transfer-asaas-pix', {
                body: {
                    amount: valor,
                    value: valor,
                    pixKey: formData.pix_key,
                    pix_key: formData.pix_key,
                    pixKeyType: formData.pix_key_type,
                    pix_key_type: formData.pix_key_type,
                    supplierId: supplier.id,
                    destinationType: 'supplier',
                    description: `Adiantamento a ${formData.name}: ${advanceReason.trim()}`,
                    operationType: 'PIX'
                }
            });

            // supabase-js nao lanca em erro: sem estas duas linhas a falha passa em silencio.
            if (error) throw error;
            if (data && data.success === false) throw new Error(data.error);

            const confirmadoNoAsaas = data?.status === 'DONE' || data?.status === 'CONFIRMED';

            if (confirmadoNoAsaas) {
                const r = await classificarAdiantamento();
                showAlert(
                    `Adiantamento de ${formatCurrency(valor)} enviado e registrado. `
                    + `Adiantamento em aberto: ${formatCurrency(r?.adiantamento_total ?? valor)}.`,
                    'success'
                );
            } else {
                // O trigger do razao so lanca quando a transferencia vira 'completed'.
                showAlert(
                    'PIX enviado, mas o Asaas ainda não confirmou. Assim que confirmar, '
                    + 'use "Classificar adiantamento" para movê-lo para a conta de adiantamentos.',
                    'warning'
                );
            }

            await addHistory('supplier', supplier.id, 'advance_paid', {
                amount: valor,
                reason: advanceReason.trim(),
                asaas_id: data?.transferId,
                asaas_status: data?.status
            }, `Adiantamento de ${formatCurrency(valor)} via PIX — ${advanceReason.trim()}`);

            fetchLedgerStatement();
        } catch (err) {
            console.error('Erro no adiantamento:', err);
            showAlert('Erro ao processar adiantamento: ' + err.message, 'error');
        } finally {
            setAdvancing(false);
        }
    };

    /** Usado quando a transferencia so confirma depois, ou para acertar historico. */
    const handleClassificar = async () => {
        setAdvancing(true);
        try {
            const r = await classificarAdiantamento();
            if (!r?.classificado) {
                showAlert('Não há pagamento acima do saldo devido para classificar.', 'info');
            } else {
                showAlert(
                    `${formatCurrency(r.classificado)} classificados como adiantamento. `
                    + `Total em aberto: ${formatCurrency(r.adiantamento_total)}.`,
                    'success'
                );
            }
            fetchLedgerStatement();
        } catch (err) {
            showAlert('Erro ao classificar: ' + err.message, 'error');
        } finally {
            setAdvancing(false);
        }
    };

    const handleManualEntry = async () => {
        if (!supplier?.id) {
            showAlert('Fornecedor precisa estar salvo antes de lançar valores.', 'warning');
            return;
        }
        if (!manualEntryAmount || isNaN(manualEntryAmount) || manualEntryAmount <= 0) {
            showAlert('Por favor, informe um valor válido.', 'warning');
            return;
        }
        if (!manualEntryDescription) {
            showAlert('Por favor, informe a descrição do lançamento.', 'warning');
            return;
        }

        setManualEntryLoading(true);
        try {
            const { data: configData } = await supabase
                .from('integrations_config')
                .select('environment')
                .eq('service_name', 'financial_api')
                .single();
            const isSandbox = configData?.environment === 'sandbox';

            // Busca as duas contas de uma vez: a do fornecedor e a contrapartida.
            const { data: accountData, error: accountError } = await supabase
                .from('ledger_accounts')
                .select('id, code')
                .in('code', ['2.1.1', manualEntryCounterAccount]);

            if (accountError) throw accountError;

            const contaFornecedor = accountData?.find(a => a.code === '2.1.1');
            const contaContrapartida = accountData?.find(a => a.code === manualEntryCounterAccount);

            if (!contaFornecedor || !contaContrapartida) {
                throw new Error('Conta não encontrada no plano de contas.');
            }
            if (contaFornecedor.id === contaContrapartida.id) {
                throw new Error('A contrapartida não pode ser a própria conta do fornecedor.');
            }

            // Crédito (negativo) = aumenta saldo a receber. Débito (positivo) = diminui saldo a receber.
            const amountToInsert = manualEntryType === 'credit' ? -Math.abs(manualEntryAmount) : Math.abs(manualEntryAmount);

            // Partida dobrada: as duas pernas no mesmo transaction_id, somando zero.
            // `reference_type` em minúsculo — 'SUPPLIER' maiúsculo não é resolvido
            // pela view_ledger_enriched e o lançamento fica órfão de fornecedor.
            const transactionId = crypto.randomUUID();
            const { error: insertError } = await supabase
                .from('ledger_entries')
                .insert([
                    {
                        transaction_id: transactionId,
                        account_id: contaFornecedor.id,
                        amount: amountToInsert,
                        description: manualEntryDescription,
                        reference_type: 'supplier',
                        reference_id: supplier.id,
                        is_sandbox: isSandbox || false
                    },
                    {
                        transaction_id: transactionId,
                        account_id: contaContrapartida.id,
                        amount: -amountToInsert,
                        description: manualEntryDescription,
                        reference_type: 'supplier',
                        reference_id: supplier.id,
                        is_sandbox: isSandbox || false
                    }
                ]);

            if (insertError) throw insertError;

            showAlert('Lançamento avulso registrado com sucesso.', 'success');
            setManualEntryAmount('');
            setManualEntryDescription('');
            fetchLedgerStatement(); // Refresh ledger
            
            await addHistory('supplier', supplier.id, 'manual_ledger_entry', {
                amount: amountToInsert,
                type: manualEntryType,
                description: manualEntryDescription
            }, `Lançamento avulso: ${manualEntryDescription} (R$ ${Math.abs(amountToInsert).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`);

        } catch (error) {
            console.error('Error inserting manual entry:', error);
            showAlert('Erro ao registrar lançamento: ' + error.message, 'error');
        } finally {
            setManualEntryLoading(false);
        }
    };

    const addHistory = async (type, id, action, details = {}, customContent = null) => {
        if (!id) return;
        try {
            await supabase.from('crm_history').insert({
                entity_type: type,
                entity_id: id,
                content: customContent || `${action}: ${details.type || ''}`,
                metadata: details,
                created_by: profile?.id
            });
        } catch (error) {
            console.error('Error adding history:', error);
        }
    };

    // Os cadastros guardam o documento ora só com dígitos, ora mascarado.
    const variantesDocumento = (doc) => [doc, maskCpfCnpj(doc)];

    // Copia só contato e endereço, e só para campo ainda vazio: o que já foi
    // digitado no fornecedor nunca é sobrescrito. Credenciais não vêm.
    const herdarContatoEEndereco = (origem) => {
        const end = origem.address || {};
        setFormData(prev => ({
            ...prev,
            name: prev.name || origem.name || '',
            email: prev.email || origem.email || '',
            phone: prev.phone || origem.phone || '',
            cep: prev.cep || origem.cep || end.cep || '',
            rua: prev.rua || origem.rua || end.rua || end.logradouro || '',
            numero: prev.numero || origem.numero || end.numero || '',
            complemento: prev.complemento || origem.complemento || end.complemento || '',
            bairro: prev.bairro || origem.bairro || end.bairro || '',
            cidade: prev.cidade || origem.cidade || end.cidade || end.municipio || '',
            uf: prev.uf || origem.uf || end.uf || ''
        }));
    };

    /**
     * Ao sair do CPF/CNPJ, procura nesta ordem: fornecedor com o mesmo
     * documento (bloqueia o duplicado), assinante, lead e, para CNPJ, a
     * Receita. Assinante e lead só pré-preenchem cadastro novo.
     */
    const handleCnpjBlur = async () => {
        const cleanDoc = cleanDigits(formData.cnpj || '');
        if (cleanDoc.length !== 11 && cleanDoc.length !== 14) return;
        const variantes = variantesDocumento(cleanDoc);

        setLoading(true);
        try {
            const { data: iguais, error: erroIguais } = await supabase
                .from('suppliers').select('id, name').in('cnpj', variantes);
            if (erroIguais) throw erroIguais;
            const outro = (iguais || []).find(s => s.id !== supplier?.id) || null;
            setFornecedorDuplicado(outro);
            if (outro) {
                showAlert(`Já existe o fornecedor "${outro.name}" com este CPF/CNPJ. Abra o cadastro dele na lista de Fornecedores.`, 'warning');
                return;
            }

            let herdou = false;
            if (!supplier?.id) {
                setLeadHerdado(null);
                setOrigemHerdada('');

                const { data: assinantes } = await supabase
                    .from('subscribers').select('*').in('cpf_cnpj', variantes).limit(1);
                if (assinantes?.length) {
                    herdarContatoEEndereco(assinantes[0]);
                    setOrigemHerdada(`assinante "${assinantes[0].name}"`);
                    herdou = true;
                } else if (!supplier?.lead_id) {
                    const { data: leads } = await supabase
                        .from('leads').select('*').in('cpf_cnpj', variantes)
                        .order('created_at', { ascending: false }).limit(1);
                    const lead = leads?.[0];
                    if (lead) {
                        // Lead que já virou outro fornecedor não é reaproveitado.
                        const { data: dono } = await supabase
                            .from('suppliers').select('id').eq('lead_id', lead.id).limit(1);
                        if (!dono?.length) {
                            herdarContatoEEndereco(lead);
                            // O banco copia o originador do lead no INSERT; aqui
                            // ele só aparece na tela.
                            setFormData(prev => ({ ...prev, originator_id: prev.originator_id || lead.originator_id || '' }));
                            setLeadHerdado(lead);
                            setOrigemHerdada(`lead "${lead.name}"`);
                            herdou = true;
                        }
                    }
                }
            }

            if (cleanDoc.length === 14) {
                const data = await fetchCpfCnpjData(cleanDoc);
                if (data) {
                    // Depois de herdar, a Receita só completa o que faltou
                    // (o sócio, em geral); sem herança, mantém o comportamento
                    // de sempre e traz os dados dela.
                    const valor = (atual, receita) => herdou ? (atual || receita || '') : (receita || atual);
                    setFormData(prev => ({
                        ...prev,
                        name: valor(prev.name, data.nome),
                        email: valor(prev.email, data.email),
                        phone: valor(prev.phone, data.telefone),
                        legal_partner_name: valor(prev.legal_partner_name, data.legal_partner?.nome),
                        legal_partner_cpf: valor(prev.legal_partner_cpf, data.legal_partner?.cpf),
                        cep: valor(prev.cep, data.address?.cep),
                        rua: valor(prev.rua, data.address?.logradouro),
                        numero: valor(prev.numero, data.address?.numero),
                        complemento: valor(prev.complemento, data.address?.complemento),
                        bairro: valor(prev.bairro, data.address?.bairro),
                        cidade: valor(prev.cidade, data.address?.municipio),
                        uf: valor(prev.uf, data.address?.uf)
                    }));
                }
            }
        } catch (e) {
            console.error('Erro na busca por CPF/CNPJ', e);
            showAlert('Erro ao buscar o CPF/CNPJ. Verifique se o número está correto.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleCepBlur = async () => {
        const cep = cleanDigits(formData.cep);
        if (cep.length === 8) {
            setSearchingCep(true);
            try {
                const data = await fetchAddressByCep(cep);
                if (data && !data.erro) {
                    setFormData(prev => ({
                        ...prev,
                        rua: data.rua || prev.rua,
                        bairro: data.bairro || prev.bairro,
                        cidade: data.cidade || prev.cidade,
                        uf: data.uf || prev.uf
                    }));
                }
            } catch (error) {
                console.error('Erro CEP:', error);
            } finally {
                setSearchingCep(false);
            }
        }
    };

    const handlePixTypeChange = (e) => {
        const type = e.target.value;
        let autoValue = formData.pix_key;

        switch (type) {
            case 'telefone':
                autoValue = formData.phone;
                break;
            case 'email':
                autoValue = formData.email;
                break;
            case 'cnpj':
                autoValue = formData.cnpj;
                break;
            case 'cpf':
                if (formData.legal_partner_cpf) autoValue = formData.legal_partner_cpf;
                break;
            default:
                break;
        }

        setFormData(prev => ({
            ...prev,
            pix_key_type: type,
            pix_key: autoValue
        }));
    };

    /**
     * O registro do fornecedor como ele vai ao banco.
     *
     * Mora fora do `handleSubmit` porque "Gerar minuta" também grava o
     * fornecedor, e duas listas de campos em paralelo envelheceriam
     * separadas.
     */
    const montarPayloadFornecedor = () => ({
        name: formData.name,
        cnpj: formData.cnpj,
        email: formData.email,
        phone: formData.phone ? formData.phone.replace(/\D/g, '') : '',
        // O status é calculado no banco (fn_recalculate_supplier_status). A
        // tela só grava a entrada e a saída de Inativo; mandar sempre o valor
        // carregado ao abrir desfaria o que o cálculo mudou nesse meio-tempo.
        ...(formData.status !== (supplier?.status || 'cadastrado')
            ? { status: formData.status }
            : {}),
        // Só se mudou: a data da Autentique tem hora e o campo mostra o dia.
        ...((formData.contrato_assinado_em || '') !== (supplier?.contrato_assinado_em?.slice(0, 10) || '')
            ? { contrato_assinado_em: formData.contrato_assinado_em || null }
            : {}),
        legal_partner_name: formData.legal_partner_name,
        legal_partner_cpf: formData.legal_partner_cpf,
        pix_key: formData.pix_key,
        pix_key_type: formData.pix_key_type,
        originator_id: formData.originator_id || null,
        address: {
            cep: formData.cep,
            logradouro: formData.rua,
            rua: formData.rua,
            numero: formData.numero,
            complemento: formData.complemento,
            bairro: formData.bairro,
            municipio: formData.cidade,
            cidade: formData.cidade,
            uf: formData.uf
        },
        ...((supplier?.lead_id || leadHerdado?.id) ? { lead_id: supplier?.lead_id || leadHerdado.id } : {})
    });

    /**
     * Fornecedor novo que veio de um lead: se ainda não houver assinante com
     * o mesmo documento, devolve o rascunho do "Novo Assinante" com os dados
     * que acabaram de ser gravados. Sem `lead_id` no assinante de propósito:
     * o gatilho do assinante grava o status do lead sem a trava de "só
     * avança" e desfaria o que o fornecedor já levou adiante.
     */
    const rascunhoAssinanteDoLead = async () => {
        const leadId = supplier?.id ? null : (supplier?.lead_id || leadHerdado?.id);
        if (!leadId) return null;

        const doc = cleanDigits(formData.cnpj || '');
        if (doc) {
            const { data: jaExiste } = await supabase
                .from('subscribers').select('id').in('cpf_cnpj', variantesDocumento(doc)).limit(1);
            if (jaExiste?.length) return null;
        }

        const lead = leadHerdado?.id === leadId
            ? leadHerdado
            : (await supabase.from('leads').select('*').eq('id', leadId).single()).data;
        if (!lead) return null;

        return {
            ...lead,
            id: null,
            status: 'ativacao',
            name: formData.name,
            cpf_cnpj: formData.cnpj,
            email: formData.email,
            phone: formData.phone,
            cep: formData.cep,
            rua: formData.rua,
            numero: formData.numero,
            complemento: formData.complemento,
            bairro: formData.bairro,
            cidade: formData.cidade,
            uf: formData.uf,
            originator_id: formData.originator_id || lead.originator_id || ''
        };
    };

    // O campo `cnpj` guarda CPF ou CNPJ: os rótulos e o bloco do sócio
    // seguem a quantidade de dígitos (até 11 é pessoa física).
    const docDigitos = cleanDigits(formData.cnpj || '');
    const docEhCpf = docDigitos.length > 0 && docDigitos.length <= 11;
    const docEhCnpj = docDigitos.length > 11;
    const rotuloNome = docEhCpf ? 'Nome Completo *'
        : docEhCnpj ? 'Razão Social / Nome Fantasia *'
            : 'Nome Completo ou Razão Social *';

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (formData.cnpj && !validateDocument(formData.cnpj)) {
            showAlert('CPF/CNPJ inválido!', 'warning');
            return;
        }
        if (formData.phone && !validatePhone(formData.phone)) {
            showAlert('Telefone inválido!', 'warning');
            return;
        }
        if (fornecedorDuplicado) {
            showAlert(`Já existe o fornecedor "${fornecedorDuplicado.name}" com este CPF/CNPJ. Abra o cadastro dele em vez de criar outro.`, 'warning');
            return;
        }

        setLoading(true);

        try {
            const payload = montarPayloadFornecedor();

            let result;
            if (supplier?.id) {
                result = await supabase.from('suppliers').update(payload).eq('id', supplier.id).select().single();
            } else {
                result = await supabase.from('suppliers').insert(payload).select().single();
            }

            if (result.error) throw result.error;

            if (supplier?.id) {
                await addHistory('supplier', supplier.id, 'supplier_updated', {
                    name: formData.name,
                    status: 'updated'
                }, 'Dados do fornecedor atualizados');
            } else if (result.data) {
                await addHistory('supplier', result.data.id, 'supplier_created', {
                    name: formData.name,
                    status: 'created'
                }, 'Novo fornecedor cadastrado');
            }

            // O fornecedor já está gravado: falha aqui não pode virar "erro ao
            // salvar fornecedor".
            let rascunho = null;
            try {
                rascunho = await rascunhoAssinanteDoLead();
            } catch (erroRascunho) {
                console.error('Erro ao preparar o assinante do lead:', erroRascunho);
            }
            if (rascunho) {
                // Fecha só depois do assinante: salvar ou fechar o modal dele
                // conclui o cadastro do fornecedor do mesmo jeito.
                setFornecedorSalvo(result.data);
                setAssinanteDoLead(rascunho);
                showAlert('Fornecedor salvo. Confira e salve o assinante criado a partir do lead.', 'success');
                return;
            }

            onSave(result.data);
            onClose();
        } catch (error) {
            console.error('Save error details:', error);
            const msg = error.message || JSON.stringify(error);
            if (msg.includes('JWT expired')) {
                showAlert('Sua sessão expirou. Por favor, faça login novamente.', 'error');
                await supabase.auth.signOut();
                window.location.href = '/login';
            } else {
                showAlert('Erro ao salvar fornecedor: ' + msg, 'error');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (usinas.length > 0) {
            showAlert('Não é possível excluir fornecedor com usinas vinculadas.', 'warning');
            return;
        }
        const confirm = await showConfirm('Excluir este fornecedor?');
        if (!confirm) return;

        setLoading(true);
        try {
            const { error } = await supabase.from('suppliers').delete().eq('id', supplier.id);
            if (error) throw error;
            if (onDelete) onDelete(supplier.id);
            onClose();
        } catch (error) {
            showAlert('Erro ao excluir: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const inputStyle = {
        width: '100%',
        padding: '0.68rem 0.9rem',
        border: '1px solid #cbd5e1',
        borderRadius: '10px',
        fontSize: '0.9rem',
        color: '#0f172a',
        fontWeight: 500,
        transition: 'all 0.15s',
        backgroundColor: '#f8fafc',
        outline: 'none'
    };

    const labelStyle = {
        display: 'block',
        fontSize: '0.76rem',
        fontWeight: '700',
        color: '#475569',
        marginBottom: '0.4rem',
        textTransform: 'uppercase',
        letterSpacing: '0.03em'
    };

    const sectionStyle = {
        background: '#ffffff',
        padding: '1.35rem 1.5rem',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
        marginBottom: '1.25rem'
    };

    const formatCurrency = (val) => {
        return Math.abs(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        // If it's just a YYYY-MM-DD string, add time to prevent timezone shift
        const dateObj = dateStr.length === 10 ? new Date(dateStr + 'T12:00:00') : new Date(dateStr);
        return dateObj.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    };

    const rawBalance = ledgerEntries.reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const ledgerBalance = Math.round(rawBalance * 100) / 100;
    const displayBalance = -ledgerBalance;
    const availableBalance = displayBalance - pendingBalance;

    const filteredLedgerEntries = ledgerEntries.filter(entry => {
        let isValid = true;
        if (extratoStartDate) {
            isValid = isValid && new Date(entry.created_at) >= new Date(extratoStartDate + 'T00:00:00');
        }
        if (extratoEndDate) {
            isValid = isValid && new Date(entry.created_at) <= new Date(extratoEndDate + 'T23:59:59');
        }
        if (extratoType === 'credit') {
            isValid = isValid && entry.amount < 0; // Negative means credit to supplier
        } else if (extratoType === 'debit') {
            isValid = isValid && entry.amount > 0;
        }
        return isValid;
    });

    const handlePrintExtrato = async () => {
        setIsGeneratingPdf(true);
        try {
            await new Promise(resolve => setTimeout(resolve, 100)); // Delay para atualizar botão na UI

            const pdf = new jsPDF('p', 'pt', 'a4');
            
            // Header
            pdf.setFontSize(14);
            pdf.setTextColor(0, 51, 102); // #003366
            pdf.text('EXTRATO DE CONTA', 40, 40);
            
            pdf.setFontSize(10);
            pdf.setTextColor(100);
            pdf.text(formData.name || 'Fornecedor', 40, 55);

            // Period and Balance
            pdf.setFontSize(9);
            pdf.setTextColor(0, 0, 0);
            const periodStr = `Período: ${extratoStartDate ? formatDate(extratoStartDate) : 'Início'} até ${extratoEndDate ? formatDate(extratoEndDate) : 'Hoje'}`;
            const typeStr = `Tipo: ${extratoType === 'all' ? 'Todos' : extratoType === 'credit' ? 'Créditos' : 'Débitos'}`;
            pdf.text(`${periodStr}   |   ${typeStr}`, 40, 75);
            
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(displayBalance >= 0 ? '#166534' : '#991b1b');
            pdf.text(`Saldo Acumulado: ${displayBalance > 0 ? '+' : displayBalance < 0 ? '-' : ''}${formatCurrency(displayBalance)}`, 40, 90);
            pdf.setTextColor(0, 0, 0);

            // Table
            const tableColumn = ["Data", "Entidade", "Descrição", "Valor"];
            const tableRows = [];

            filteredLedgerEntries.forEach(entry => {
                const date = formatDate(entry.created_at);
                const entity = translateEntity(entry.entity_name || 'Sistema');
                
                const isRevenue = entry.amount < 0;
                const isRepasse = entry.description?.toLowerCase().includes('repasse');
                const subscriberOrig = isRepasse ? (repasseOrigins[entry.transaction_id] || entry.metadata?.subscriber_name || entry.metadata?.consumer_name || entry.metadata?.nome_assinante || entry.metadata?.originator_name) : null;
                const kwhCompensated = entry.metadata?.kwh || entry.metadata?.kwh_compensado || entry.metadata?.kWh || null;

                let descText = entry.description || '';
                if (subscriberOrig) {
                    descText = `${subscriberOrig}\n${entry.description} ${kwhCompensated ? '| ' + kwhCompensated + ' kWh' : ''}`;
                }

                const valueStr = (isRevenue ? '+' : '-') + formatCurrency(entry.amount);

                tableRows.push([date, entity, descText, valueStr]);
            });

            autoTable(pdf, {
                startY: 105,
                head: [tableColumn],
                body: tableRows,
                theme: 'striped',
                headStyles: { fillColor: [0, 51, 102], fontSize: 9 },
                styles: { fontSize: 8, cellPadding: 4 },
                columnStyles: {
                    0: { cellWidth: 60 },
                    1: { cellWidth: 80 },
                    2: { cellWidth: 'auto' },
                    3: { cellWidth: 80, halign: 'right', fontStyle: 'bold' }
                },
                didParseCell: function(data) {
                    if (data.section === 'body' && data.column.index === 3) {
                        const valStr = data.cell.raw;
                        if (valStr.startsWith('+')) {
                            data.cell.styles.textColor = [22, 101, 52]; // #166534
                        } else if (valStr.startsWith('-')) {
                            data.cell.styles.textColor = [153, 27, 27]; // #991b1b
                        }
                    }
                }
            });

            const cleanName = (formData.name || 'Fornecedor').normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_').replace(/[^\w]/g, '');
            const fileName = `Extrato_${cleanName}_${new Date().toISOString().split('T')[0]}.pdf`;
            
            pdf.save(fileName);
            
            if (showAlert) {
                showAlert('PDF gerado com sucesso!', 'success');
            }
        } catch (error) {
            console.error('Erro ao gerar PDF:', error);
            if (showAlert) showAlert('Erro ao gerar PDF: ' + error.message, 'error');
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const translateEntity = (name) => {
        if (!name) return '';
        const map = {
            'SUPPLIER': 'Fornecedor',
            'INVOICE': 'Fatura',
            'MANAGEMENT': 'Gestão',
            'MAINTENANCE': 'Manutenção',
            'RENT': 'Aluguel',
            'TAX': 'Taxa',
            'SUBSCRIPTION': 'Assinatura'
        };
        return map[name.toUpperCase()] || name;
    };

    const renderHiddenExtratoDetail = () => {
        return (
            <div style={{
                width: '800px',
                minWidth: '800px',
                padding: '40px',
                background: '#f8fafc',
                boxSizing: 'border-box',
                fontFamily: "'Inter', 'Montserrat', 'Helvetica', 'Arial', sans-serif"
            }}>
                <div style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0',
                    overflow: 'hidden',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                    width: '100%'
                }}>
                    {/* Branded Header */}
                    <div style={{
                        padding: '16px 24px',
                        borderBottom: '1px solid #f1f5f9',
                        display: 'flex',
                        justifyContent: 'flex-start',
                        alignItems: 'center',
                        background: '#ffffff'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontWeight: '700', color: '#003366', fontSize: '1.1rem' }}>
                            <span>B2W Energia</span>
                        </div>
                    </div>

                    {/* Dark Title Banner */}
                    <div style={{
                        backgroundColor: '#003366',
                        padding: '20px 24px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <h3 style={{ margin: 0, color: '#ffffff', fontSize: '1.1rem', fontWeight: 600 }}>
                                EXTRATO DE CONTA
                            </h3>
                        </div>
                        <span style={{
                            padding: '6px 16px',
                            borderRadius: '30px',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            backgroundColor: '#2563eb'
                        }}>
                            {formData.name}
                        </span>
                    </div>

                    {/* Info Section */}
                    <div style={{
                        padding: '24px',
                        background: '#ffffff',
                        borderBottom: '1px solid #e2e8f0'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#475569' }}>
                            <div style={{ display: 'flex', gap: '2rem' }}>
                                <div><strong>Período:</strong> {extratoStartDate ? formatDate(extratoStartDate) : 'Início'} até {extratoEndDate ? formatDate(extratoEndDate) : 'Hoje'}</div>
                                <div><strong>Tipo:</strong> {extratoType === 'all' ? 'Todos' : extratoType === 'credit' ? 'Créditos' : 'Débitos'}</div>
                            </div>
                            <div>
                                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Gerado em: {new Date().toLocaleString('pt-BR')}</span>
                            </div>
                        </div>
                        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                            <div style={{
                                background: '#f0fdf4',
                                padding: '8px 16px',
                                borderRadius: '8px',
                                border: '1px solid #dcfce7',
                                display: 'inline-block'
                            }}>
                                <strong style={{ fontSize: '1.1rem', color: '#166534' }}>
                                    Saldo Acumulado: {displayBalance > 0 ? '+' : displayBalance < 0 ? '-' : ''}{formatCurrency(displayBalance)}
                                </strong>
                            </div>
                        </div>
                    </div>

                    {/* Table Area */}
                    <div style={{ padding: '16px 24px', background: '#ffffff' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', background: '#f1f5f9' }}>
                                    <th style={{ padding: '6px 10px', color: '#475569', fontWeight: 700, fontSize: '10px' }}>Data</th>
                                    <th style={{ padding: '6px 10px', color: '#475569', fontWeight: 700, fontSize: '10px' }}>Entidade</th>
                                    <th style={{ padding: '6px 10px', color: '#475569', fontWeight: 700, fontSize: '10px' }}>Descrição</th>
                                    <th style={{ padding: '6px 10px', color: '#475569', fontWeight: 700, textAlign: 'right', fontSize: '10px' }}>Valor</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredLedgerEntries.map((entry, index) => {
                                    const isRevenue = entry.amount < 0;
                                    const isRepasse = entry.description?.toLowerCase().includes('repasse');
                                    const subscriberOrig = isRepasse ? (repasseOrigins[entry.transaction_id] || entry.metadata?.subscriber_name || entry.metadata?.consumer_name || entry.metadata?.nome_assinante || entry.metadata?.originator_name) : null;
                                    const kwhCompensated = entry.metadata?.kwh || entry.metadata?.kwh_compensado || entry.metadata?.kWh || null;

                                    return (
                                        <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9', background: index % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                                            <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: '#475569', fontSize: '10px' }}>
                                                {formatDate(entry.created_at)}
                                            </td>
                                            <td style={{ padding: '6px 10px', color: '#475569', fontWeight: '500', fontSize: '10px' }}>
                                                {translateEntity(entry.entity_name || 'Sistema')}
                                            </td>
                                            <td style={{ padding: '6px 10px' }}>
                                                {subscriberOrig ? (
                                                    <div>
                                                        <div style={{ fontWeight: '700', color: '#1e293b', fontSize: '10px' }}>
                                                            {subscriberOrig}
                                                        </div>
                                                        <div style={{ color: '#64748b', fontSize: '8px', marginTop: '1px' }}>
                                                            {entry.description} {kwhCompensated && ` | ${kwhCompensated} kWh`}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ fontWeight: '700', color: '#1e293b', fontSize: '10px' }}>
                                                        {entry.description}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '700', color: isRevenue ? '#166534' : '#991b1b', fontSize: '10px' }}>
                                                {isRevenue ? '+' : '-'}{formatCurrency(entry.amount)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
        <style>{`
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(6px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes supSpin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .sup-spin {
                animation: supSpin 0.8s linear infinite;
            }
            .sup-modal-input:focus {
                border-color: #2563eb !important;
                background-color: #ffffff !important;
                box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12) !important;
            }
            .sup-modal-grid-2 {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
                gap: 1.25rem;
                align-items: start;
            }
            .sup-kpi-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
                gap: 0.85rem;
            }
            .sup-manual-grid {
                display: grid;
                grid-template-columns: 150px 1.4fr 1.8fr 150px auto;
                gap: 0.65rem;
                align-items: end;
            }
            @media (max-width: 960px) {
                .sup-modal-grid-2 {
                    grid-template-columns: 1fr;
                }
                .sup-manual-grid {
                    grid-template-columns: 1fr 1fr;
                }
            }
        `}</style>
        <div className="print-wrapper" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.68)', backdropFilter: 'blur(6px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
            padding: '1rem'
        }}>
            <div className="extrato-print-container" style={{ 
                background: '#f8fafc', 
                borderRadius: '16px', 
                width: '96vw', 
                maxWidth: '1380px', 
                height: '92vh',
                maxHeight: '92vh', 
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.38)',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative'
            }}>
                {/* Pinned Authority Header */}
                <div className="no-print" style={{
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                    padding: '1.15rem 1.75rem',
                    color: 'white',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    flexShrink: 0
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
                        <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '12px',
                            background: 'rgba(59, 130, 246, 0.18)',
                            border: '1px solid rgba(96, 165, 250, 0.35)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#60a5fa',
                            flexShrink: 0
                        }}>
                            <Building2 size={22} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#ffffff' }}>
                                    {supplier ? (formData.name || 'Editar Fornecedor') : 'Novo Fornecedor'}
                                </h3>
                                <span style={{
                                    padding: '0.22rem 0.7rem',
                                    borderRadius: '999px',
                                    fontWeight: 700,
                                    fontSize: '0.74rem',
                                    color: (STATUS_FORNECEDOR[formData.status] || STATUS_FORNECEDOR.cadastrado).cor,
                                    background: (STATUS_FORNECEDOR[formData.status] || STATUS_FORNECEDOR.cadastrado).fundo,
                                    letterSpacing: '0.01em'
                                }}>
                                    {(STATUS_FORNECEDOR[formData.status] || { rotulo: formData.status }).rotulo}
                                </span>
                                {supplier && usinas.length > 0 && (
                                    <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.3rem',
                                        padding: '0.22rem 0.65rem',
                                        borderRadius: '999px',
                                        background: 'rgba(14, 165, 233, 0.18)',
                                        border: '1px solid rgba(56, 189, 248, 0.3)',
                                        color: '#7dd3fc',
                                        fontSize: '0.73rem',
                                        fontWeight: 700,
                                        fontVariantNumeric: 'tabular-nums'
                                    }}>
                                        <Zap size={12} /> {usinas.length} {usinas.length === 1 ? 'usina vinculada' : 'usinas vinculadas'}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem', fontSize: '0.82rem', color: '#94a3b8', flexWrap: 'wrap' }}>
                                <span>{supplier ? 'Ficha cadastral, governança bancária e razão contábil do parceiro' : 'Cadastro de parceiro gerador e infraestrutura energética'}</span>
                                {formData.cnpj && (
                                    <>
                                        <span style={{ opacity: 0.4 }}>•</span>
                                        <span style={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', color: '#cbd5e1', fontWeight: 600 }}>
                                            CNPJ: {formData.cnpj}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        {supplier && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('extrato')}
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'flex-end',
                                        background: 'rgba(255, 255, 255, 0.06)',
                                        border: '1px solid rgba(255, 255, 255, 0.12)',
                                        borderRadius: '10px',
                                        padding: '0.4rem 0.85rem',
                                        cursor: 'pointer',
                                        color: 'white',
                                        transition: 'background 0.15s'
                                    }}
                                    title="Clique para abrir o Extrato Financeiro"
                                >
                                    <span style={{ fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', fontWeight: 700 }}>
                                        Saldo Acumulado
                                    </span>
                                    <span style={{
                                        fontSize: '0.95rem',
                                        fontWeight: 800,
                                        fontVariantNumeric: 'tabular-nums',
                                        color: displayBalance > 0 ? '#4ade80' : displayBalance < 0 ? '#f87171' : '#f8fafc'
                                    }}>
                                        {displayBalance > 0 ? '+' : displayBalance < 0 ? '-' : ''}{formatCurrency(displayBalance)}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleRefreshModalData}
                                    disabled={refreshing || ledgerLoading}
                                    title="Atualizar saldos, extrato e dados do fornecedor sem fechar o modal"
                                    style={{
                                        background: 'rgba(59, 130, 246, 0.16)',
                                        border: '1px solid rgba(96, 165, 250, 0.35)',
                                        color: '#e0f2fe',
                                        height: '38px',
                                        padding: '0 0.85rem',
                                        borderRadius: '10px',
                                        cursor: (refreshing || ledgerLoading) ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.45rem',
                                        fontSize: '0.8rem',
                                        fontWeight: 700,
                                        opacity: (refreshing || ledgerLoading) ? 0.7 : 1,
                                        transition: 'all 0.15s'
                                    }}
                                    onMouseEnter={e => { if (!refreshing && !ledgerLoading) e.currentTarget.style.background = 'rgba(59, 130, 246, 0.28)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.16)'; }}
                                >
                                    <RefreshCw size={15} className={(refreshing || ledgerLoading) ? 'sup-spin' : ''} />
                                    <span>{(refreshing || ledgerLoading) ? 'Atualizando...' : 'Atualizar'}</span>
                                </button>
                            </>
                        )}
                        <button 
                            type="button"
                            onClick={onClose}
                            aria-label="Fechar modal"
                            style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                color: '#e2e8f0',
                                width: '38px',
                                height: '38px',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.16)'; e.currentTarget.style.color = '#ffffff'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = '#e2e8f0'; }}
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Pinned Horizontal Navigation Bar */}
                <div className="no-print" style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    padding: '0.6rem 1.75rem',
                    background: '#ffffff',
                    borderBottom: '1px solid #e2e8f0',
                    overflowX: 'auto',
                    flexShrink: 0
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {[
                            { id: 'geral', label: 'Geral', icon: User, badge: usinas.length > 0 ? `${usinas.length}` : null },
                            { id: 'endereco', label: 'Endereço', icon: MapPin, badge: formData.uf || null },
                            { id: 'financeiro', label: 'Financeiro', icon: Wallet, badge: formData.pix_key ? 'PIX' : null },
                            { id: 'extrato', label: 'Extrato', icon: ArrowUpDown, badge: ledgerEntries.length > 0 ? `${ledgerEntries.length}` : null },
                            ...(supplier ? [{ id: 'historico', label: 'Histórico', icon: History, badge: null }] : [])
                        ].map(tab => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.55rem 1rem',
                                        borderRadius: '10px',
                                        border: isActive ? '1px solid #bfdbfe' : '1px solid transparent',
                                        background: isActive ? '#eff6ff' : 'transparent',
                                        color: isActive ? '#1d4ed8' : '#475569',
                                        fontWeight: isActive ? 700 : 600,
                                        fontSize: '0.86rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s',
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    <tab.icon size={16} color={isActive ? '#2563eb' : '#64748b'} />
                                    <span>{tab.label}</span>
                                    {tab.badge && (
                                        <span style={{
                                            padding: '0.1rem 0.45rem',
                                            borderRadius: '999px',
                                            fontSize: '0.68rem',
                                            fontWeight: 700,
                                            fontVariantNumeric: 'tabular-nums',
                                            background: isActive ? '#dbeafe' : '#f1f5f9',
                                            color: isActive ? '#1e40af' : '#64748b'
                                        }}>
                                            {tab.badge}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {supplier?.id && (
                        <div style={{ fontSize: '0.75rem', color: '#64748b', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            ID: <span style={{ fontFamily: 'monospace', color: '#475569', fontWeight: 600 }}>{String(supplier.id).slice(0, 8)}</span>
                        </div>
                    )}
                </div>

                {/* Form wrapping Scrollable Body + Pinned Footer */}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '1.5rem 1.75rem', overflowY: 'auto', flex: 1 }}>
                        
                        {/* ==================== ABA 1: GERAL ==================== */}
                        {activeTab === 'geral' && (
                            <div style={{ animation: 'fadeIn 0.2s ease-out', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                <div className="sup-modal-grid-2">
                                    {/* Coluna Esquerda: Empresa + Contato */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                        <div style={{ ...sectionStyle, marginBottom: 0 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.15rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                                <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                                    <Building2 size={18} color="#2563eb" /> Dados do Fornecedor
                                                </h4>
                                                {loading && (
                                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#2563eb', background: '#eff6ff', padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                                                        Consultando CPF/CNPJ...
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                                                <div>
                                                    <label style={labelStyle}>CPF/CNPJ (busca automática no CNPJ)</label>
                                                    <input
                                                        className="sup-modal-input"
                                                        style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums', borderColor: '#cbd5e1' }}
                                                        value={formData.cnpj}
                                                        onChange={e => {
                                                            setFormData({ ...formData, cnpj: maskCpfCnpj(e.target.value) });
                                                            setFornecedorDuplicado(null);
                                                        }}
                                                        onBlur={handleCnpjBlur}
                                                        placeholder="000.000.000-00 ou 00.000.000/0000-00"
                                                    />
                                                    {fornecedorDuplicado && (
                                                        <p style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', fontWeight: 700, color: '#b91c1c' }}>
                                                            Já existe o fornecedor "{fornecedorDuplicado.name}" com este CPF/CNPJ.
                                                        </p>
                                                    )}
                                                    {!fornecedorDuplicado && origemHerdada && (
                                                        <p style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', color: '#2563eb' }}>
                                                            Contato e endereço trazidos do {origemHerdada}. Confira antes de salvar.
                                                        </p>
                                                    )}
                                                </div>
                                                <div>
                                                    <label style={labelStyle}>{rotuloNome}</label>
                                                    <input
                                                        className="sup-modal-input"
                                                        style={inputStyle}
                                                        required
                                                        placeholder="Informe o nome completo ou razão social do fornecedor"
                                                        value={formData.name}
                                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ ...sectionStyle, marginBottom: 0 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.15rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                                <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                                    <Mail size={18} color="#2563eb" /> Informações de Contato
                                                </h4>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
                                                <div>
                                                    <label style={labelStyle}>E-mail Corporativo / Financeiro</label>
                                                    <input
                                                        className="sup-modal-input"
                                                        style={inputStyle}
                                                        type="email"
                                                        placeholder="contato@empresa.com.br"
                                                        value={formData.email}
                                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                                    />
                                                </div>
                                                <div>
                                                    <label style={labelStyle}>Telefone / WhatsApp</label>
                                                    <input
                                                        className="sup-modal-input"
                                                        style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
                                                        placeholder="(00) 00000-0000"
                                                        value={formData.phone}
                                                        onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Coluna Direita: Sócio Administrador + Originador */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                        {docEhCnpj && (
                                        <div style={{ ...sectionStyle, marginBottom: 0 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.15rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                                <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                                    <CheckCircle size={18} color="#16a34a" /> Sócio Administrador / Representante Legal
                                                </h4>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '1rem' }}>
                                                <div>
                                                    <label style={labelStyle}>Nome Completo</label>
                                                    <input
                                                        className="sup-modal-input"
                                                        style={inputStyle}
                                                        placeholder="Nome do representante"
                                                        value={formData.legal_partner_name}
                                                        onChange={e => setFormData({ ...formData, legal_partner_name: e.target.value })}
                                                    />
                                                </div>
                                                <div>
                                                    <label style={labelStyle}>CPF do Sócio</label>
                                                    <input
                                                        className="sup-modal-input"
                                                        style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
                                                        placeholder="000.000.000-00"
                                                        value={formData.legal_partner_cpf}
                                                        onChange={e => setFormData({ ...formData, legal_partner_cpf: maskCpfCnpj(e.target.value) })}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        )}

                                        <div style={{ ...sectionStyle, marginBottom: 0 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.15rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                                <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                                    <User size={18} color="#0284c7" /> Originador Comercial
                                                </h4>
                                                {!ehAdmin && (
                                                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', background: '#f1f5f9', padding: '0.18rem 0.55rem', borderRadius: '6px' }}>
                                                        Somente leitura
                                                    </span>
                                                )}
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Quem originou este fornecedor</label>
                                                <select
                                                    className="sup-modal-input"
                                                    style={{ ...inputStyle, cursor: ehAdmin ? 'pointer' : 'not-allowed', opacity: ehAdmin ? 1 : 0.75 }}
                                                    value={formData.originator_id}
                                                    disabled={!ehAdmin}
                                                    onChange={e => setFormData({ ...formData, originator_id: e.target.value })}
                                                >
                                                    <option value="">Sem originador vinculado</option>
                                                    {originadores.map(o => (
                                                        <option key={o.id} value={o.id} disabled={!o.ativo && o.id !== formData.originator_id}>
                                                            {o.name}{o.cargo ? ` · ${o.cargo}` : ''}{o.ativo ? '' : ' (inativo)'}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p style={{ margin: '0.65rem 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45 }}>
                                                    As usinas deste fornecedor herdam o originador. Ele recebe o percentual que o Plano de Usina de cada uma prevê; sem originador, essa parte permanece na associação.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                {supplier && usinas.length > 0 && (
                                    <div style={{
                                        ...sectionStyle,
                                        marginBottom: 0,
                                        background: 'linear-gradient(135deg, #f0f9ff 0%, #f8fafc 100%)',
                                        border: '1px solid #bae6fd'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
                                            <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#0369a1', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                                                <Zap size={18} color="#0284c7" /> Usinas Vinculadas ao Fornecedor
                                            </h4>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0369a1', background: '#e0f2fe', padding: '0.2rem 0.65rem', borderRadius: '999px', fontVariantNumeric: 'tabular-nums' }}>
                                                {usinas.length} {usinas.length === 1 ? 'unidade geradora' : 'unidades geradoras'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
                                            {usinas.map(u => {
                                                const isAtiva = u.status === 'ativo' || u.status === 'gerando';
                                                return (
                                                    <div key={u.id} style={{
                                                        background: '#ffffff',
                                                        padding: '0.55rem 0.95rem',
                                                        borderRadius: '10px',
                                                        fontSize: '0.84rem',
                                                        border: '1px solid #bae6fd',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.55rem',
                                                        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
                                                    }}>
                                                        <span style={{
                                                            width: 8,
                                                            height: 8,
                                                            borderRadius: '50%',
                                                            background: isAtiva ? '#16a34a' : '#d97706',
                                                            flexShrink: 0
                                                        }} />
                                                        <strong style={{ color: '#0f172a', fontWeight: 700 }}>{u.name}</strong>
                                                        {u.status && (
                                                            <span style={{
                                                                fontSize: '0.7rem',
                                                                fontWeight: 600,
                                                                color: isAtiva ? '#166534' : '#92400e',
                                                                background: isAtiva ? '#dcfce7' : '#fef3c7',
                                                                padding: '0.1rem 0.45rem',
                                                                borderRadius: '6px',
                                                                textTransform: 'capitalize'
                                                            }}>
                                                                {u.status}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ==================== ABA 2: ENDEREÇO ==================== */}
                        {activeTab === 'endereco' && (
                            <div style={{ animation: 'fadeIn 0.2s ease-out' }}>
                                <div style={{ ...sectionStyle, marginBottom: 0 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                            <MapPin size={18} color="#dc2626" /> Endereço e Localização Fiscal
                                        </h4>
                                        {searchingCep && (
                                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#2563eb', background: '#eff6ff', padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                                                Buscando CEP...
                                            </span>
                                        )}
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.15rem' }}>
                                        <div style={{ gridColumn: 'span 3' }}>
                                            <label style={labelStyle}>CEP (Busca Automática)</label>
                                            <input
                                                className="sup-modal-input"
                                                style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
                                                placeholder="00000-000"
                                                value={formData.cep}
                                                onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                                onBlur={handleCepBlur}
                                            />
                                        </div>
                                        <div style={{ gridColumn: 'span 6' }}>
                                            <label style={labelStyle}>Logradouro / Rua / Avenida</label>
                                            <input
                                                className="sup-modal-input"
                                                style={inputStyle}
                                                placeholder="Ex.: Av. Paulista"
                                                value={formData.rua}
                                                onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                            />
                                        </div>
                                        <div style={{ gridColumn: 'span 3' }}>
                                            <label style={labelStyle}>Número</label>
                                            <input
                                                className="sup-modal-input"
                                                style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
                                                placeholder="S/N ou Nº"
                                                value={formData.numero}
                                                onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                            />
                                        </div>

                                        <div style={{ gridColumn: 'span 4' }}>
                                            <label style={labelStyle}>Complemento</label>
                                            <input
                                                className="sup-modal-input"
                                                style={inputStyle}
                                                placeholder="Sala, Galpão, Faz., Km..."
                                                value={formData.complemento || ''}
                                                onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                            />
                                        </div>
                                        <div style={{ gridColumn: 'span 3' }}>
                                            <label style={labelStyle}>Bairro / Distrito</label>
                                            <input
                                                className="sup-modal-input"
                                                style={inputStyle}
                                                placeholder="Bairro"
                                                value={formData.bairro}
                                                onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                            />
                                        </div>
                                        <div style={{ gridColumn: 'span 3' }}>
                                            <label style={labelStyle}>Cidade / Município</label>
                                            <input
                                                className="sup-modal-input"
                                                style={inputStyle}
                                                placeholder="Cidade"
                                                value={formData.cidade}
                                                onChange={e => setFormData({ ...formData, cidade: e.target.value })}
                                            />
                                        </div>
                                        <div style={{ gridColumn: 'span 2' }}>
                                            <label style={labelStyle}>UF</label>
                                            <input
                                                className="sup-modal-input"
                                                style={{ ...inputStyle, textTransform: 'uppercase', fontWeight: 700, textAlign: 'center' }}
                                                maxLength={2}
                                                placeholder="UF"
                                                value={formData.uf}
                                                onChange={e => setFormData({ ...formData, uf: e.target.value.toUpperCase() })}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ==================== ABA 3: FINANCEIRO ==================== */}
                        {activeTab === 'financeiro' && (
                            <div style={{ animation: 'fadeIn 0.2s ease-out', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                {/* Resumo Executivo de Saldos (Alto Contraste) */}
                                <div style={{ 
                                    background: '#ffffff',
                                    padding: '1.25rem 1.5rem',
                                    borderRadius: '14px',
                                    border: '1px solid #e2e8f0',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    gap: '1.25rem',
                                    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
                                        <div>
                                            <div style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                                Saldo Acumulado na Conta Corrente
                                            </div>
                                            <div style={{
                                                fontSize: '1.75rem',
                                                fontWeight: 800,
                                                fontVariantNumeric: 'tabular-nums',
                                                color: displayBalance > 0 ? '#15803d' : displayBalance < 0 ? '#b91c1c' : '#0f172a',
                                                marginTop: '0.2rem',
                                                letterSpacing: '-0.02em'
                                            }}>
                                                {displayBalance > 0 ? '+' : displayBalance < 0 ? '-' : ''}{formatCurrency(displayBalance)}
                                            </div>
                                        </div>

                                        <div style={{ height: '38px', width: '1px', background: '#e2e8f0' }} />

                                        <div>
                                            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                                Disponível p/ Repasse PIX
                                            </div>
                                            <div style={{
                                                fontSize: '1.15rem',
                                                fontWeight: 800,
                                                fontVariantNumeric: 'tabular-nums',
                                                color: availableBalance > 0 ? '#0f172a' : '#64748b',
                                                marginTop: '0.25rem'
                                            }}>
                                                {availableBalance > 0 ? '+' : availableBalance < 0 ? '-' : ''}{formatCurrency(availableBalance)}
                                            </div>
                                        </div>

                                        {pendingBalance > 0 && (
                                            <>
                                                <div style={{ height: '38px', width: '1px', background: '#e2e8f0' }} />
                                                <div>
                                                    <div style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                                        Saldo Retido (Pendente)
                                                    </div>
                                                    <div style={{ fontSize: '1.15rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#b45309', marginTop: '0.25rem' }}>
                                                        {formatCurrency(pendingBalance)}
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {advanceBalance > 0 && (
                                            <>
                                                <div style={{ height: '38px', width: '1px', background: '#e2e8f0' }} />
                                                <div>
                                                    <div style={{ fontSize: '0.72rem', color: '#c2410c', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                                        Adiantamento em Aberto
                                                    </div>
                                                    <div style={{ fontSize: '1.15rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#c2410c', marginTop: '0.25rem' }}>
                                                        {formatCurrency(advanceBalance)}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                        {supplier?.id && (
                                            <button
                                                type="button"
                                                onClick={handleRefreshModalData}
                                                disabled={refreshing || ledgerLoading}
                                                style={{
                                                    background: '#ffffff',
                                                    border: '1px solid #cbd5e1',
                                                    padding: '0.65rem 0.95rem',
                                                    borderRadius: '10px',
                                                    fontSize: '0.84rem',
                                                    fontWeight: 700,
                                                    color: '#334155',
                                                    cursor: (refreshing || ledgerLoading) ? 'not-allowed' : 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.4rem',
                                                    opacity: (refreshing || ledgerLoading) ? 0.65 : 1,
                                                    transition: 'all 0.15s'
                                                }}
                                            >
                                                <RefreshCw size={15} className={(refreshing || ledgerLoading) ? 'sup-spin' : ''} />
                                                {(refreshing || ledgerLoading) ? 'Atualizando...' : 'Atualizar'}
                                            </button>
                                        )}
                                        <button 
                                            type="button"
                                            onClick={() => setActiveTab('extrato')}
                                            style={{
                                                background: '#eff6ff',
                                                border: '1px solid #bfdbfe',
                                                padding: '0.65rem 1.15rem',
                                                borderRadius: '10px',
                                                fontSize: '0.85rem',
                                                fontWeight: 700,
                                                color: '#1d4ed8',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.45rem',
                                                transition: 'all 0.15s'
                                            }}
                                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#dbeafe'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#eff6ff'; }}
                                        >
                                            <ArrowUpDown size={16} /> Abrir Extrato e Pagamentos
                                        </button>
                                    </div>
                                </div>

                                <div className="sup-modal-grid-2">
                                    {/* Status Operacional e Contrato */}
                                    <div style={{ ...sectionStyle, marginBottom: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.15rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                                <CheckCircle size={18} color="#16a34a" /> Status Operacional e Governança
                                            </h4>
                                        </div>

                                        <div style={{
                                            background: '#f8fafc',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '12px',
                                            padding: '1rem',
                                            marginBottom: '1.15rem'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Estágio Atual:</span>
                                                    <span style={{
                                                        padding: '0.32rem 0.85rem',
                                                        borderRadius: '999px',
                                                        fontWeight: 700,
                                                        fontSize: '0.82rem',
                                                        color: (STATUS_FORNECEDOR[formData.status] || STATUS_FORNECEDOR.cadastrado).cor,
                                                        background: (STATUS_FORNECEDOR[formData.status] || STATUS_FORNECEDOR.cadastrado).fundo
                                                    }}>
                                                        {(STATUS_FORNECEDOR[formData.status] || { rotulo: formData.status }).rotulo}
                                                    </span>
                                                </div>

                                                <label style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.45rem',
                                                    fontWeight: 700,
                                                    fontSize: '0.8rem',
                                                    color: formData.status === 'inativo' ? '#991b1b' : '#475569',
                                                    background: formData.status === 'inativo' ? '#fee2e2' : '#ffffff',
                                                    border: `1px solid ${formData.status === 'inativo' ? '#fecaca' : '#cbd5e1'}`,
                                                    padding: '0.35rem 0.75rem',
                                                    borderRadius: '8px',
                                                    cursor: 'pointer'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={formData.status === 'inativo'}
                                                        onChange={e => setFormData({
                                                            ...formData,
                                                            status: e.target.checked
                                                                ? 'inativo'
                                                                : (supplier?.status && supplier.status !== 'inativo' ? supplier.status : 'cadastrado')
                                                        })}
                                                    />
                                                    Marcar como Inativo
                                                </label>
                                            </div>
                                            <small style={{ display: 'block', marginTop: '0.65rem', color: '#64748b', fontSize: '0.76rem', lineHeight: 1.45 }}>
                                                Calculado automaticamente pelos contratos e usinas: Compra e Venda assinada → <strong>Contrato Assinado</strong>; Gestão assinada → <strong>Em Ativação</strong>; Gestão + usina em conexão, gerando ou manutenção → <strong>Ativo</strong>.
                                            </small>
                                        </div>

                                        <div>
                                            <label style={labelStyle}>Contrato de Gestão assinado em</label>
                                            <input
                                                type="date"
                                                className="sup-modal-input"
                                                style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
                                                value={formData.contrato_assinado_em}
                                                onChange={e => setFormData({ ...formData, contrato_assinado_em: e.target.value })}
                                            />
                                            <small style={{ display: 'block', marginTop: '0.45rem', color: '#64748b', fontSize: '0.75rem', lineHeight: 1.4 }}>
                                                Preenchido automaticamente quando assinado via Autentique. Caso assinado externamente (papel ou gov.br), informe a data acima.
                                            </small>
                                        </div>
                                    </div>

                                    {/* Dados Bancários e PIX */}
                                    <div style={{ ...sectionStyle, marginBottom: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.15rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                                <Wallet size={18} color="#d97706" /> Dados Bancários e Chave PIX
                                            </h4>
                                            {formData.pix_key && (
                                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534', background: '#dcfce7', padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                                                    PIX Configurado
                                                </span>
                                            )}
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '1rem' }}>
                                            <div>
                                                <label style={labelStyle}>Tipo de Chave</label>
                                                <select
                                                    className="sup-modal-input"
                                                    style={inputStyle}
                                                    value={formData.pix_key_type}
                                                    onChange={handlePixTypeChange}
                                                >
                                                    <option value="cpf">CPF</option>
                                                    <option value="cnpj">CNPJ</option>
                                                    <option value="email">E-mail</option>
                                                    <option value="telefone">Telefone</option>
                                                    <option value="aleatoria">Chave Aleatória</option>
                                                </select>
                                            </div>

                                            <div>
                                                <label style={labelStyle}>Chave PIX para Transferências Asaas</label>
                                                <div style={{ position: 'relative' }}>
                                                    <input
                                                        className="sup-modal-input"
                                                        style={{ ...inputStyle, paddingRight: '5.5rem', fontVariantNumeric: 'tabular-nums' }}
                                                        placeholder="Informe a chave PIX do favorecido"
                                                        value={formData.pix_key}
                                                        onChange={e => setFormData({ ...formData, pix_key: e.target.value })}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (!formData.pix_key) return;
                                                            navigator.clipboard.writeText(formData.pix_key);
                                                            showAlert('Chave PIX copiada!', 'success');
                                                        }}
                                                        style={{
                                                            position: 'absolute',
                                                            right: '6px',
                                                            top: '50%',
                                                            transform: 'translateY(-50%)',
                                                            background: '#ffffff',
                                                            border: '1px solid #cbd5e1',
                                                            borderRadius: '8px',
                                                            padding: '0.35rem 0.65rem',
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '0.3rem',
                                                            color: '#334155',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 700
                                                        }}
                                                        title="Copiar Chave PIX"
                                                    >
                                                        <Copy size={13} /> Copiar
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{
                                            marginTop: '1.15rem',
                                            padding: '0.85rem 1rem',
                                            background: '#f8fafc',
                                            borderRadius: '10px',
                                            border: '1px solid #e2e8f0',
                                            fontSize: '0.78rem',
                                            color: '#475569',
                                            lineHeight: 1.45
                                        }}>
                                            Os repasses de faturas compensadas e adiantamentos utilizam esta chave PIX diretamente via integração <strong>Asaas</strong>. Certifique-se de que a titularidade corresponde ao CNPJ ou Sócio Administrador cadastrado.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ==================== ABA 4: EXTRATO ==================== */}
                        {activeTab === 'extrato' && (
                            <div style={{ animation: 'fadeIn 0.2s ease-out', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
                                {/* Painel Executivo de Saldos e Ações Financeiras */}
                                <div className="no-print" style={{
                                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                                    padding: '1.35rem 1.5rem',
                                    borderRadius: '14px',
                                    color: 'white',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    boxShadow: '0 10px 20px -5px rgba(15, 23, 42, 0.25)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '1.15rem'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                                        <div className="sup-kpi-grid" style={{ flex: '1 1 680px' }}>
                                            {/* KPI 1: Saldo Acumulado */}
                                            <div style={{
                                                background: 'rgba(255, 255, 255, 0.05)',
                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                borderRadius: '12px',
                                                padding: '0.9rem 1.1rem'
                                            }}>
                                                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 700 }}>
                                                    Saldo Acumulado (2.1.1)
                                                </div>
                                                <div style={{
                                                    fontSize: '1.65rem',
                                                    fontWeight: 800,
                                                    fontVariantNumeric: 'tabular-nums',
                                                    color: displayBalance > 0 ? '#4ade80' : displayBalance < 0 ? '#f87171' : '#ffffff',
                                                    marginTop: '0.2rem',
                                                    letterSpacing: '-0.02em'
                                                }}>
                                                    {displayBalance > 0 ? '+' : displayBalance < 0 ? '-' : ''}{formatCurrency(displayBalance)}
                                                </div>
                                                {displayBalance < 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={handleClassificar}
                                                        disabled={advancing || !podeMoverDinheiro}
                                                        style={{
                                                            marginTop: '0.5rem',
                                                            background: 'rgba(248, 113, 113, 0.16)',
                                                            border: '1px solid rgba(248, 113, 113, 0.4)',
                                                            borderRadius: '6px',
                                                            padding: '0.28rem 0.65rem',
                                                            color: '#fecaca',
                                                            fontWeight: 700,
                                                            fontSize: '0.74rem',
                                                            cursor: (advancing || !podeMoverDinheiro) ? 'not-allowed' : 'pointer',
                                                            opacity: (advancing || !podeMoverDinheiro) ? 0.6 : 1
                                                        }}
                                                        title="Move para a conta de adiantamentos o que foi pago acima do saldo devido"
                                                    >
                                                        {advancing ? 'Classificando...' : 'Classificar como adiantamento'}
                                                    </button>
                                                )}
                                            </div>

                                            {/* KPI 2: Disponível para Saque */}
                                            <div style={{
                                                background: 'rgba(255, 255, 255, 0.05)',
                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                borderRadius: '12px',
                                                padding: '0.9rem 1.1rem'
                                            }}>
                                                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 700 }}>
                                                    Disponível p/ Repasse
                                                </div>
                                                <div style={{
                                                    fontSize: '1.45rem',
                                                    fontWeight: 800,
                                                    fontVariantNumeric: 'tabular-nums',
                                                    color: availableBalance > 0 ? '#38bdf8' : '#e2e8f0',
                                                    marginTop: '0.25rem'
                                                }}>
                                                    {availableBalance > 0 ? '+' : availableBalance < 0 ? '-' : ''}{formatCurrency(availableBalance)}
                                                </div>
                                                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                                                    Liberado após conciliação
                                                </div>
                                            </div>

                                            {/* KPI 3: Saldo Retido */}
                                            <div style={{
                                                background: 'rgba(255, 255, 255, 0.05)',
                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                borderRadius: '12px',
                                                padding: '0.9rem 1.1rem'
                                            }}>
                                                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 700 }}>
                                                    Retido / Em Trânsito
                                                </div>
                                                <div style={{
                                                    fontSize: '1.45rem',
                                                    fontWeight: 800,
                                                    fontVariantNumeric: 'tabular-nums',
                                                    color: pendingBalance > 0 ? '#fbbf24' : '#64748b',
                                                    marginTop: '0.25rem'
                                                }}>
                                                    {formatCurrency(pendingBalance)}
                                                </div>
                                                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                                                    Transferências pendentes
                                                </div>
                                            </div>

                                            {/* KPI 4: Adiantamento em Aberto */}
                                            <div style={{
                                                background: 'rgba(255, 255, 255, 0.05)',
                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                borderRadius: '12px',
                                                padding: '0.9rem 1.1rem'
                                            }}>
                                                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 700 }}>
                                                    Adiantamento (1.1.3)
                                                </div>
                                                <div style={{
                                                    fontSize: '1.45rem',
                                                    fontWeight: 800,
                                                    fontVariantNumeric: 'tabular-nums',
                                                    color: advanceBalance > 0 ? '#fb923c' : '#64748b',
                                                    marginTop: '0.25rem'
                                                }}>
                                                    {formatCurrency(advanceBalance)}
                                                </div>
                                                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                                                    Abatido nas faturas pagas
                                                </div>
                                            </div>
                                        </div>

                                        {/* Botões de Movimentação PIX */}
                                        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <button 
                                                type="button"
                                                onClick={handlePayPix}
                                                disabled={paying || availableBalance <= 0 || !(['super_admin', 'superadmin', 'admin', 'gerente'].includes(profile?.role))}
                                                style={{ 
                                                    background: availableBalance > 0 ? '#16a34a' : 'rgba(255,255,255,0.1)', 
                                                    padding: '0.75rem 1.35rem', 
                                                    borderRadius: '10px',
                                                    border: '1px solid rgba(255,255,255,0.15)',
                                                    color: 'white',
                                                    fontWeight: 700,
                                                    fontSize: '0.88rem',
                                                    cursor: (paying || availableBalance <= 0 || !(['super_admin', 'superadmin', 'admin', 'gerente'].includes(profile?.role))) ? 'not-allowed' : 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    opacity: (paying || availableBalance <= 0 || !(['super_admin', 'superadmin', 'admin', 'gerente'].includes(profile?.role))) ? 0.55 : 1,
                                                    transition: 'all 0.15s'
                                                }}
                                            >
                                                <Wallet size={17} />
                                                {paying ? 'Processando...' : 'Pagar Agora (PIX)'}
                                            </button>

                                            <button
                                                type="button"
                                                onClick={handleAdvance}
                                                disabled={advancing || paying || !podeMoverDinheiro}
                                                title="Paga o fornecedor antes do faturamento. O valor fica como adiantamento e é abatido conforme as faturas forem pagas."
                                                style={{
                                                    background: 'rgba(255, 255, 255, 0.08)',
                                                    padding: '0.75rem 1.2rem',
                                                    borderRadius: '10px',
                                                    border: '1px solid rgba(255, 255, 255, 0.25)',
                                                    color: 'white',
                                                    fontWeight: 700,
                                                    fontSize: '0.88rem',
                                                    cursor: (advancing || paying || !podeMoverDinheiro) ? 'not-allowed' : 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    opacity: (advancing || paying || !podeMoverDinheiro) ? 0.55 : 1,
                                                    transition: 'all 0.15s'
                                                }}
                                            >
                                                <ArrowUpRight size={17} />
                                                {advancing ? 'Enviando...' : 'Adiantar Valor'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Barra de Lançamento Avulso em Partida Dobrada */}
                                    {supplier?.id && (
                                        <div style={{
                                            background: 'rgba(15, 23, 42, 0.55)',
                                            border: '1px solid rgba(255, 255, 255, 0.1)',
                                            borderRadius: '12px',
                                            padding: '0.9rem 1rem'
                                        }}>
                                            <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginBottom: '0.6rem' }}>
                                                Lançamento Manual no Razão (Partida Dobrada)
                                            </div>
                                            <div className="sup-manual-grid">
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.68rem', color: '#cbd5e1', marginBottom: '0.25rem', fontWeight: 600 }}>Natureza</label>
                                                    <select
                                                        value={manualEntryType}
                                                        onChange={e => setManualEntryType(e.target.value)}
                                                        style={{
                                                            width: '100%',
                                                            padding: '0.5rem 0.65rem',
                                                            borderRadius: '8px',
                                                            border: '1px solid rgba(255,255,255,0.2)',
                                                            background: 'rgba(255,255,255,0.1)',
                                                            color: 'white',
                                                            fontSize: '0.82rem',
                                                            fontWeight: 600,
                                                            outline: 'none',
                                                            cursor: 'pointer',
                                                            height: '38px'
                                                        }}
                                                    >
                                                        <option value="credit" style={{ color: '#1e293b' }}>Crédito (+)</option>
                                                        <option value="debit" style={{ color: '#1e293b' }}>Débito (-)</option>
                                                    </select>
                                                </div>

                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.68rem', color: '#cbd5e1', marginBottom: '0.25rem', fontWeight: 600 }}>Conta de Contrapartida</label>
                                                    <select
                                                        value={manualEntryCounterAccount}
                                                        onChange={e => setManualEntryCounterAccount(e.target.value)}
                                                        title="Conta de contrapartida — de onde sai (ou para onde vai) o valor"
                                                        style={{
                                                            width: '100%',
                                                            padding: '0.5rem 0.65rem',
                                                            borderRadius: '8px',
                                                            border: '1px solid rgba(255,255,255,0.2)',
                                                            background: 'rgba(255,255,255,0.1)',
                                                            color: 'white',
                                                            fontSize: '0.82rem',
                                                            fontWeight: 600,
                                                            outline: 'none',
                                                            cursor: 'pointer',
                                                            height: '38px'
                                                        }}
                                                    >
                                                        {counterAccounts.length === 0 && (
                                                            <option value="2.1.4" style={{ color: '#1e293b' }}>2.1.4 · Despesas Operacionais Usina</option>
                                                        )}
                                                        {counterAccounts.map(c => (
                                                            <option key={c.code} value={c.code} style={{ color: '#1e293b' }}>
                                                                {c.code} · {c.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>

                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.68rem', color: '#cbd5e1', marginBottom: '0.25rem', fontWeight: 600 }}>Histórico / Descrição</label>
                                                    <input
                                                        placeholder="Descreva o motivo do lançamento..."
                                                        value={manualEntryDescription}
                                                        onChange={e => setManualEntryDescription(e.target.value)}
                                                        style={{
                                                            width: '100%',
                                                            padding: '0.5rem 0.75rem',
                                                            borderRadius: '8px',
                                                            border: '1px solid rgba(255,255,255,0.15)',
                                                            background: '#ffffff',
                                                            color: '#0f172a',
                                                            fontSize: '0.84rem',
                                                            fontWeight: 600,
                                                            outline: 'none',
                                                            height: '38px'
                                                        }}
                                                    />
                                                </div>

                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.68rem', color: '#cbd5e1', marginBottom: '0.25rem', fontWeight: 600 }}>Valor (R$)</label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        placeholder="0,00"
                                                        value={manualEntryAmount}
                                                        onChange={e => setManualEntryAmount(e.target.value)}
                                                        style={{
                                                            width: '100%',
                                                            padding: '0.5rem 0.75rem',
                                                            borderRadius: '8px',
                                                            border: '1px solid rgba(255,255,255,0.15)',
                                                            background: '#ffffff',
                                                            color: '#0f172a',
                                                            fontSize: '0.84rem',
                                                            fontWeight: 700,
                                                            fontVariantNumeric: 'tabular-nums',
                                                            outline: 'none',
                                                            height: '38px'
                                                        }}
                                                    />
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={handleManualEntry}
                                                    disabled={manualEntryLoading || !manualEntryAmount || !manualEntryDescription}
                                                    style={{
                                                        background: manualEntryType === 'credit' ? '#16a34a' : '#dc2626',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        padding: '0 1.25rem',
                                                        borderRadius: '8px',
                                                        fontWeight: 700,
                                                        fontSize: '0.84rem',
                                                        cursor: (manualEntryLoading || !manualEntryAmount || !manualEntryDescription) ? 'not-allowed' : 'pointer',
                                                        opacity: (manualEntryLoading || !manualEntryAmount || !manualEntryDescription) ? 0.55 : 1,
                                                        transition: 'all 0.15s',
                                                        height: '38px',
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    {manualEntryLoading ? 'Lançando...' : 'Registrar'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Tabela de Lançamentos e Filtros */}
                                <div style={{ ...sectionStyle, marginBottom: 0, padding: '1.25rem 1.5rem' }}>
                                    <div style={{ display: 'none' }} className="print-only-header">
                                        <div style={{ marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid #e2e8f0', color: '#1e293b' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <h2 style={{ margin: '0', color: '#003366', fontSize: '1.2rem', textTransform: 'uppercase' }}>EXTRATO DE CONTA - {formData.name}</h2>
                                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Gerado em: {new Date().toLocaleString('pt-BR')}</div>
                                            </div>
                                            
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', fontSize: '0.9rem' }}>
                                                <div style={{ display: 'flex', gap: '2rem' }}>
                                                    <div><strong>Período:</strong> {extratoStartDate ? formatDate(extratoStartDate) : 'Início'} até {extratoEndDate ? formatDate(extratoEndDate) : 'Hoje'}</div>
                                                    <div><strong>Tipo:</strong> {extratoType === 'all' ? 'Todos' : extratoType === 'credit' ? 'Créditos' : 'Débitos'}</div>
                                                </div>
                                                <div>
                                                    <strong style={{ fontSize: '1.1rem' }}>Saldo Acumulado: {displayBalance > 0 ? '+' : displayBalance < 0 ? '-' : ''}{formatCurrency(displayBalance)}</strong>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Barra de Ferramentas e Filtros do Razão */}
                                    <div className="no-print" style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: '0.85rem',
                                        marginBottom: '1.15rem',
                                        paddingBottom: '0.9rem',
                                        borderBottom: '1px solid #f1f5f9'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                                <ArrowUpDown size={18} color="#2563eb" /> Lançamentos do Razão
                                            </h4>
                                            <span style={{
                                                padding: '0.15rem 0.55rem',
                                                borderRadius: '999px',
                                                background: '#f1f5f9',
                                                color: '#475569',
                                                fontSize: '0.74rem',
                                                fontWeight: 700,
                                                fontVariantNumeric: 'tabular-nums'
                                            }}>
                                                {filteredLedgerEntries.length} {filteredLedgerEntries.length === 1 ? 'registro' : 'registros'}
                                            </span>
                                        </div>

                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                            <input
                                                type="date"
                                                value={extratoStartDate}
                                                onChange={e => setExtratoStartDate(e.target.value)}
                                                style={{
                                                    padding: '0.42rem 0.65rem',
                                                    borderRadius: '8px',
                                                    border: '1px solid #cbd5e1',
                                                    background: '#f8fafc',
                                                    fontSize: '0.8rem',
                                                    color: '#0f172a',
                                                    fontWeight: 600,
                                                    fontVariantNumeric: 'tabular-nums'
                                                }}
                                            />
                                            <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>até</span>
                                            <input
                                                type="date"
                                                value={extratoEndDate}
                                                onChange={e => setExtratoEndDate(e.target.value)}
                                                style={{
                                                    padding: '0.42rem 0.65rem',
                                                    borderRadius: '8px',
                                                    border: '1px solid #cbd5e1',
                                                    background: '#f8fafc',
                                                    fontSize: '0.8rem',
                                                    color: '#0f172a',
                                                    fontWeight: 600,
                                                    fontVariantNumeric: 'tabular-nums'
                                                }}
                                            />
                                            <select
                                                value={extratoType}
                                                onChange={e => setExtratoType(e.target.value)}
                                                style={{
                                                    padding: '0.42rem 0.7rem',
                                                    borderRadius: '8px',
                                                    border: '1px solid #cbd5e1',
                                                    background: '#f8fafc',
                                                    fontSize: '0.8rem',
                                                    color: '#0f172a',
                                                    fontWeight: 600
                                                }}
                                            >
                                                <option value="all">Todos os tipos</option>
                                                <option value="credit">Créditos (+)</option>
                                                <option value="debit">Débitos (-)</option>
                                            </select>

                                            {(extratoStartDate || extratoEndDate || extratoType !== 'all') && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setExtratoStartDate(''); setExtratoEndDate(''); setExtratoType('all'); }}
                                                    style={{
                                                        padding: '0.42rem 0.65rem',
                                                        borderRadius: '8px',
                                                        border: '1px solid #e2e8f0',
                                                        background: '#ffffff',
                                                        color: '#64748b',
                                                        fontSize: '0.76rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Limpar
                                                </button>
                                            )}

                                            <button
                                                type="button"
                                                onClick={handleRefreshModalData}
                                                disabled={refreshing || ledgerLoading}
                                                title="Recarregar lançamentos do razão e saldos"
                                                style={{
                                                    background: '#eff6ff',
                                                    padding: '0.45rem 0.85rem',
                                                    borderRadius: '8px',
                                                    border: '1px solid #bfdbfe',
                                                    color: '#1d4ed8',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 700,
                                                    cursor: (refreshing || ledgerLoading) ? 'not-allowed' : 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.4rem',
                                                    opacity: (refreshing || ledgerLoading) ? 0.65 : 1,
                                                    transition: 'all 0.15s'
                                                }}
                                            >
                                                <RefreshCw size={14} className={(refreshing || ledgerLoading) ? 'sup-spin' : ''} />
                                                {(refreshing || ledgerLoading) ? 'Atualizando...' : 'Atualizar'}
                                            </button>

                                            <button 
                                                type="button"
                                                onClick={handlePrintExtrato}
                                                disabled={isGeneratingPdf}
                                                style={{ 
                                                    background: '#0f172a', 
                                                    padding: '0.45rem 0.85rem', 
                                                    borderRadius: '8px',
                                                    border: '1px solid #0f172a',
                                                    color: '#ffffff',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 700,
                                                    cursor: isGeneratingPdf ? 'not-allowed' : 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.4rem',
                                                    opacity: isGeneratingPdf ? 0.7 : 1
                                                }}
                                            >
                                                <Download size={14} /> {isGeneratingPdf ? 'Gerando PDF...' : 'Exportar PDF'}
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {ledgerLoading ? (
                                        <div style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b', fontSize: '0.9rem' }}>
                                            Carregando lançamentos do razão...
                                        </div>
                                    ) : filteredLedgerEntries.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b', border: '1px dashed #cbd5e1', borderRadius: '12px', background: '#f8fafc' }}>
                                            Nenhum lançamento encontrado para os filtros selecionados.
                                        </div>
                                    ) : (
                                        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                                <thead>
                                                    <tr style={{ textAlign: 'left', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                                        <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 700, fontSize: '0.73rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Data</th>
                                                        <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 700, fontSize: '0.73rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Entidade</th>
                                                        <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 700, fontSize: '0.73rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Descrição / Assinante</th>
                                                        <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 700, fontSize: '0.73rem', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' }}>Valor</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {filteredLedgerEntries.map(entry => {
                                                        // In the vision of the Supplier (Account 2.1.1 - Liability):
                                                        // Credit (Negative amount) = Money they have to receive (Revenue/Positive for them)
                                                        // Debit (Positive amount) = Money deducted from them (Expense/Negative for them)
                                                        const isRevenue = entry.amount < 0;
                                                        const isRepasse = entry.description?.toLowerCase().includes('repasse');
                                                        const subscriberOrig = isRepasse ? (repasseOrigins[entry.transaction_id] || entry.metadata?.subscriber_name || entry.metadata?.consumer_name || entry.metadata?.nome_assinante || entry.metadata?.originator_name) : null;
                                                        const kwhCompensated = entry.metadata?.kwh || entry.metadata?.kwh_compensado || entry.metadata?.kWh || null;
                                                        const isExpanded = expandedTx === entry.transaction_id;

                                                        return (
                                                            <React.Fragment key={entry.id}>
                                                                <tr 
                                                                    onClick={() => fetchTransactionDetails(entry.transaction_id)}
                                                                    style={{ 
                                                                        borderBottom: '1px solid #f1f5f9', 
                                                                        cursor: 'pointer',
                                                                        background: isExpanded ? '#f8fafc' : '#ffffff',
                                                                        transition: 'background 0.15s'
                                                                    }}
                                                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isExpanded ? '#f8fafc' : '#ffffff'}
                                                                >
                                                                    <td style={{ padding: '0.9rem 1rem', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                                                                        <div style={{ color: '#475569', fontWeight: 600, fontSize: '0.82rem' }}>{formatDate(entry.created_at)}</div>
                                                                    </td>
                                                                    <td style={{ padding: '0.9rem 1rem', whiteSpace: 'nowrap' }}>
                                                                        <span style={{
                                                                            display: 'inline-block',
                                                                            padding: '0.2rem 0.55rem',
                                                                            borderRadius: '6px',
                                                                            background: '#f1f5f9',
                                                                            color: '#334155',
                                                                            fontWeight: 600,
                                                                            fontSize: '0.76rem'
                                                                        }}>
                                                                            {translateEntity(entry.entity_name || 'Sistema')}
                                                                        </span>
                                                                    </td>
                                                                    <td style={{ padding: '0.9rem 1rem' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                                                                            <div className="no-print" style={{
                                                                                width: '30px',
                                                                                height: '30px',
                                                                                borderRadius: '8px',
                                                                                background: isRevenue ? '#dcfce7' : '#fee2e2',
                                                                                color: isRevenue ? '#15803d' : '#b91c1c',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                justifyContent: 'center',
                                                                                flexShrink: 0
                                                                            }}>
                                                                                {isRevenue ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                                                                            </div>
                                                                            <div>
                                                                                {subscriberOrig ? (
                                                                                    <>
                                                                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>
                                                                                            {subscriberOrig}
                                                                                        </div>
                                                                                        <div style={{ fontWeight: 500, color: '#64748b', fontSize: '0.76rem', marginTop: '0.1rem' }}>
                                                                                            {entry.description} {kwhCompensated && ` • ${kwhCompensated} kWh compensados`}
                                                                                        </div>
                                                                                    </>
                                                                                ) : (
                                                                                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>
                                                                                        {entry.description}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                    <td style={{ padding: '0.9rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                            <span className="print-value" style={{
                                                                                fontWeight: 800,
                                                                                fontSize: '0.95rem',
                                                                                fontVariantNumeric: 'tabular-nums',
                                                                                color: isRevenue ? '#15803d' : '#b91c1c'
                                                                            }}>
                                                                                {isRevenue ? '+' : '-'}{formatCurrency(entry.amount)}
                                                                            </span>
                                                                            <span className="no-print" style={{ color: '#94a3b8', display: 'inline-flex' }}>
                                                                                {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                                                            </span>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                                
                                                                {isExpanded && (
                                                                    <tr>
                                                                        <td colSpan={4} style={{ padding: '0 1rem 0.9rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                                                            <div style={{ 
                                                                                background: '#ffffff', 
                                                                                borderRadius: '10px', 
                                                                                padding: '1rem 1.25rem',
                                                                                border: '1px solid #cbd5e1',
                                                                                animation: 'fadeIn 0.15s ease-out'
                                                                            }}>
                                                                                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.65rem', letterSpacing: '0.04em' }}>
                                                                                    Composição Contábil do Lançamento (Partida Dobrada)
                                                                                </div>
                                                                                {txLoading ? (
                                                                                    <div style={{ color: '#64748b', fontSize: '0.8rem' }}>Carregando detalhes...</div>
                                                                                ) : (
                                                                                    (() => {
                                                                                        const filtered = txDetails.filter(d => d.account_code !== '2.1.1');
                                                                                        const grouped = filtered.reduce((acc, curr) => {
                                                                                            const key = `${curr.description}-${curr.entity_name}`;
                                                                                            if (!acc[key]) {
                                                                                                acc[key] = { ...curr };
                                                                                                acc[key].amount = -curr.amount;
                                                                                            } else {
                                                                                                acc[key].amount -= curr.amount;
                                                                                            }
                                                                                            return acc;
                                                                                        }, {});

                                                                                        const finalDetails = Object.values(grouped);

                                                                                        if (finalDetails.length === 0) {
                                                                                            return <div style={{ color: '#64748b', fontSize: '0.8rem' }}>Detalhes não disponíveis para esta visualização.</div>;
                                                                                        }

                                                                                        return (
                                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                                                                {finalDetails.map((detail, idx) => (
                                                                                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: idx < finalDetails.length - 1 ? '1px dashed #e2e8f0' : 'none' }}>
                                                                                                        <div>
                                                                                                            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.82rem' }}>
                                                                                                                {translateEntity(detail.entity_name || detail.account_name)}
                                                                                                            </div>
                                                                                                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{detail.description}</div>
                                                                                                        </div>
                                                                                                        <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: '0.85rem', color: detail.amount < 0 ? '#15803d' : '#b91c1c' }}>
                                                                                                            {detail.amount < 0 ? '+' : '-'}{formatCurrency(detail.amount)}
                                                                                                        </div>
                                                                                                    </div>
                                                                                                ))}
                                                                                            </div>
                                                                                        );
                                                                                    })()
                                                                                )}
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ==================== ABA 5: HISTÓRICO ==================== */}
                        {activeTab === 'historico' && supplier && (
                            <div className="no-print" style={{ animation: 'fadeIn 0.2s ease-out' }}>
                                <div style={{ ...sectionStyle, marginBottom: 0 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <div>
                                            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                                <History size={18} color="#2563eb" /> Timeline de Auditoria e Alterações
                                            </h4>
                                            <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                                                Registro cronológico de eventos cadastrais, financeiros e operacionais deste fornecedor.
                                            </p>
                                        </div>
                                    </div>
                                    <HistoryTimeline 
                                        entityType="supplier" 
                                        entityId={supplier.id} 
                                        limit={20}
                                        showHeader={false}
                                        isInline={true}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Pinned Modal Footer Actions */}
                    <div className="no-print" style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '1rem 1.75rem',
                        background: '#ffffff',
                        borderTop: '1px solid #e2e8f0',
                        flexShrink: 0,
                        gap: '1rem',
                        flexWrap: 'wrap'
                    }}>
                        <div>
                            {supplier && (
                                <button 
                                    type="button" 
                                    onClick={handleDelete}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.45rem',
                                        padding: '0.62rem 1.1rem',
                                        background: '#fef2f2',
                                        color: '#dc2626',
                                        border: '1px solid #fecaca',
                                        borderRadius: '10px',
                                        fontWeight: 700,
                                        fontSize: '0.84rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s'
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#fee2e2'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = '#fef2f2'; }}
                                >
                                    <Trash2 size={16} /> Excluir Fornecedor
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                            {supplier?.id && (
                                <ConvidarAppButton tipo="supplier" id={supplier.id} nome={supplier.name} style={{ borderRadius: '10px', padding: '0.62rem 1.1rem', fontSize: '0.84rem' }} />
                            )}
                            <button
                                type="button"
                                onClick={onClose}
                                style={{
                                    padding: '0.62rem 1.25rem',
                                    background: '#ffffff',
                                    color: '#475569',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '10px',
                                    fontWeight: 700,
                                    fontSize: '0.84rem',
                                    cursor: 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                            <button 
                                type="submit" 
                                disabled={loading}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.45rem',
                                    padding: '0.62rem 1.5rem',
                                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '10px',
                                    fontWeight: 700,
                                    fontSize: '0.86rem',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
                                    transition: 'all 0.15s'
                                }}
                            >
                                {loading ? (
                                    'Processando...'
                                ) : (
                                    <><Save size={16} /> Salvar Alterações</>
                                )}
                            </button>
                        </div>
                    </div>
                </form>

                {/* Adiantamento ao fornecedor */}
                {showAdvanceModal && (
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)',
                        zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'center',
                        animation: 'fadeIn 0.15s ease-out', padding: '1rem'
                    }}>
                        <div style={{
                            background: '#ffffff', borderRadius: '16px', width: '92%', maxWidth: '440px',
                            padding: '1.75rem', border: '1px solid #e2e8f0',
                            boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.2)'
                        }}>
                            <div style={{
                                width: '52px', height: '52px', borderRadius: '12px', background: '#fff7ed',
                                border: '1px solid #fed7aa',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem',
                                color: '#ea580c'
                            }}>
                                <ArrowUpRight size={26} />
                            </div>
                            <h4 style={{ margin: '0 0 0.4rem', fontSize: '1.15rem', color: '#0f172a', fontWeight: 800, textAlign: 'center' }}>
                                Adiantar ao Fornecedor
                            </h4>
                            <p style={{ color: '#64748b', fontSize: '0.84rem', lineHeight: 1.5, marginBottom: '1.25rem', textAlign: 'center' }}>
                                Pagamento antecipado ao faturamento. O valor entra como <strong>adiantamento (1.1.3)</strong> e é abatido conforme as faturas dos assinantes forem pagas.
                            </p>

                            <label style={{ ...labelStyle, marginBottom: '0.35rem' }}>Valor do Adiantamento</label>
                            <div style={{ position: 'relative', marginBottom: '0.9rem' }}>
                                <span style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: '#64748b', fontSize: '0.9rem' }}>R$</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    autoFocus
                                    style={{ width: '100%', padding: '0.7rem 0.8rem 0.7rem 2.6rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums', fontSize: '0.95rem' }}
                                    value={advanceAmount}
                                    onChange={(e) => setAdvanceAmount(e.target.value)}
                                />
                            </div>

                            <label style={{ ...labelStyle, marginBottom: '0.35rem' }}>Motivo / Observação</label>
                            <input
                                type="text"
                                placeholder="Ex.: adiantamento de geração, faturas ainda não emitidas"
                                style={{ width: '100%', padding: '0.7rem 0.85rem', borderRadius: '10px', border: '1px solid #cbd5e1', color: '#0f172a', marginBottom: '1.1rem', fontSize: '0.88rem' }}
                                value={advanceReason}
                                onChange={(e) => setAdvanceReason(e.target.value)}
                            />

                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.8rem 0.95rem', marginBottom: '1.25rem' }}>
                                <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                                    Destino PIX (Asaas)
                                </div>
                                <div style={{ fontSize: '0.86rem', color: '#0f172a', fontWeight: 700, wordBreak: 'break-all', fontVariantNumeric: 'tabular-nums' }}>
                                    {formData.pix_key} ({formData.pix_key_type?.toUpperCase()})
                                </div>
                                {advanceBalance > 0 && (
                                    <div style={{ fontSize: '0.76rem', color: '#b45309', marginTop: '0.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                                        Já há {formatCurrency(advanceBalance)} de adiantamento em aberto.
                                    </div>
                                )}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                <button
                                    type="button"
                                    onClick={confirmAdvance}
                                    style={{
                                        padding: '0.75rem', background: '#ea580c', color: 'white', borderRadius: '10px',
                                        border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem'
                                    }}
                                >
                                    Confirmar e Enviar Adiantamento
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowAdvanceModal(false)}
                                    style={{
                                        padding: '0.7rem', background: 'white', color: '#64748b', borderRadius: '10px',
                                        border: '1px solid #cbd5e1', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem'
                                    }}
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Custom Payment Modal */}
                {showPaymentModal && (
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)',
                        zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'center',
                        animation: 'fadeIn 0.15s ease-out', padding: '1rem'
                    }}>
                        <div style={{
                            background: '#ffffff', borderRadius: '16px', width: '92%', maxWidth: '420px',
                            padding: '1.75rem', border: '1px solid #e2e8f0',
                            boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.2)',
                            textAlign: 'center'
                        }}>
                            <div style={{ 
                                width: '52px', height: '52px', borderRadius: '12px', background: '#eff6ff',
                                border: '1px solid #bfdbfe',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem',
                                color: '#2563eb'
                            }}>
                                <Wallet size={26} />
                            </div>
                            <h4 style={{ margin: '0 0 0.6rem', fontSize: '1.15rem', color: '#0f172a', fontWeight: 800 }}>Confirmação de Repasse PIX</h4>
                            
                            {!isPartial ? (
                                <p style={{ color: '#64748b', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: '1.5rem' }}>
                                    Deseja realizar a transferência de <strong style={{ color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(paymentAmount)}</strong> via PIX para a chave <strong style={{ color: '#0f172a' }}>{formData.pix_key}</strong> ({formData.pix_key_type?.toUpperCase()})?
                                </p>
                            ) : (
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <label style={{ ...labelStyle, textAlign: 'left', marginBottom: '0.4rem' }}>Valor do Pagamento Parcial</label>
                                    <div style={{ position: 'relative' }}>
                                        <span style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: '#64748b', fontSize: '0.9rem' }}>R$</span>
                                        <input 
                                            type="number"
                                            style={{ ...inputStyle, paddingLeft: '2.6rem', fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}
                                            value={paymentAmount}
                                            onChange={(e) => setPaymentAmount(e.target.value)}
                                            autoFocus
                                        />
                                    </div>
                                    <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.4rem', textAlign: 'left', fontVariantNumeric: 'tabular-nums' }}>
                                        Limite disponível: {formatCurrency(Math.abs(displayBalance))}
                                    </p>
                                </div>
                            )}

                            <div style={{ 
                                background: '#f8fafc', 
                                padding: '0.85rem 1rem', 
                                borderRadius: '10px', 
                                border: '1px solid #e2e8f0',
                                marginBottom: '1.25rem',
                                textAlign: 'left'
                            }}>
                                <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                                    Destino (Chave PIX)
                                </div>
                                <div style={{ fontSize: '0.86rem', color: '#0f172a', fontWeight: 700, wordBreak: 'break-all', fontVariantNumeric: 'tabular-nums' }}>
                                    {formData.pix_key} ({formData.pix_key_type?.toUpperCase()})
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                <button 
                                    type="button"
                                    onClick={confirmPixPayment}
                                    style={{
                                        padding: '0.75rem', background: '#16a34a', color: 'white', borderRadius: '10px',
                                        border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem'
                                    }}
                                >
                                    Confirmar Pagamento PIX
                                </button>
                                
                                {!isPartial && (
                                    <button 
                                        type="button"
                                        onClick={() => setIsPartial(true)}
                                        style={{
                                            padding: '0.7rem', background: '#f1f5f9', color: '#334155', borderRadius: '10px',
                                            border: '1px solid #e2e8f0', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem'
                                        }}
                                    >
                                        Informar Outro Valor
                                    </button>
                                )}

                                <button 
                                    type="button"
                                    onClick={() => setShowPaymentModal(false)}
                                    style={{
                                        padding: '0.7rem', background: 'white', color: '#64748b', borderRadius: '10px',
                                        border: '1px solid #cbd5e1', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem'
                                    }}
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            
            {/* Hidden Offscreen Container for Generating High-Quality Extrato PDF */}
            <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', overflow: 'hidden', height: 0 }}>
                <div ref={extratoPrintRef}>
                    {renderHiddenExtratoDetail()}
                </div>
            </div>

            {assinanteDoLead && (
                <SubscriberModal
                    subscriber={assinanteDoLead}
                    // Criar o assinante não fecha o modal dele (segue para
                    // Documentos); o cadastro do fornecedor termina quando
                    // o modal do assinante for fechado, salvo ou não.
                    onClose={() => {
                        setAssinanteDoLead(null);
                        onSave(fornecedorSalvo);
                        onClose();
                    }}
                    onSave={() => {}}
                />
            )}

        </div>
        </>
    );
}
