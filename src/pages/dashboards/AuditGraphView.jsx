import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { 
  AlertTriangle, CheckCircle2, Zap, Settings, ZoomIn, ZoomOut, 
  Maximize, Play, Pause, RefreshCw, UserCheck, ShieldAlert, 
  FileText, X, Eye, EyeOff, ShieldCheck, ChevronRight, ChevronLeft, HelpCircle,
  MessageSquare, Send, User, DollarSign, Building, Layers, Globe
} from 'lucide-react';
import { useUI } from '../../contexts/UIContext';

export default function AuditGraphView({ onInspectInvoice }) {
  const { showAlert, showConfirm } = useUI();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [ucs, setUcs] = useState([]);
  const [inconsistencies, setInconsistencies] = useState([]);
  
  // Graph States
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  
  // View options & interactive state
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  
  // Sidebar states
  const [activeAlertId, setActiveAlertId] = useState(null);
  const [agentMessage, setAgentMessage] = useState('Analisando base de faturas...');
  const [agentStatus, setAgentStatus] = useState('scanning'); // scanning, ready, action
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeLegendFilter, setActiveLegendFilter] = useState(null);
  const [activeInconsistency, setActiveInconsistency] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Floating AI Chat States
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    { id: 1, sender: 'agent', text: 'Olá! Sou o assistente de auditoria e aprendizado. Você pode me pedir insights das faturas ou me ensinar novos critérios de auditoria para o sistema (ex: "ignorar faturas abaixo de R$ 15" ou "ignorar desvios menores que 15%"). O que deseja analisar hoje?', timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }
  ]);
  const [customRules, setCustomRules] = useState([]);
  const chatMessagesEndRef = useRef(null);
  
  // Physics parameters (Obsidian style config sliders)
  const [repulsion, setRepulsion] = useState(300);
  const [linkDistance, setLinkDistance] = useState(90);
  const [gravity, setGravity] = useState(0.04);
  const [healthyVisible, setHealthyVisible] = useState(true);
  const [criticalCycleIndex, setCriticalCycleIndex] = useState(0);
  const [warningCycleIndex, setWarningCycleIndex] = useState(0);
  const [ucCycleIndex, setUcCycleIndex] = useState(0);
  const [auditPeriodFilter, setAuditPeriodFilter] = useState('all');
  
  // Expanded CRM entities states
  const [leads, setLeads] = useState([]);
  const [originators, setOriginators] = useState([]);
  const [subscribers, setSubscribers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [usinas, setUsinas] = useState([]);
  const [consolidatedInvoices, setConsolidatedInvoices] = useState([]);
  
  // Interactive Custom Context Menu & Details states
  const [contextMenu, setContextMenu] = useState(null);
  const [inspectedEntity, setInspectedEntity] = useState(null);
  
  // Interaction tracking
  const svgRef = useRef(null);
  const isDraggingCanvasRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggingNodeIdRef = useRef(null);
  const nodesStateRef = useRef([]);

  // Dimensions of graph canvas
  const width = 850;
  const height = 550;

  // Initialize and Fetch Data
  useEffect(() => {
    fetchAuditData();
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatMessagesEndRef.current) {
      chatMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Re-run audit scanning when custom rules or period filter changes
  useEffect(() => {
    if (invoices.length > 0) {
      runAudit(
        invoices,
        ucs,
        leads,
        originators,
        subscribers,
        suppliers,
        usinas,
        consolidatedInvoices
      );
    }
  }, [customRules, auditPeriodFilter, leads, originators, subscribers, suppliers, usinas, consolidatedInvoices]);

  const fetchAuditData = async () => {
    setLoading(true);
    setAgentStatus('scanning');
    setAgentMessage('Carregando informações do ecossistema CRM e faturas...');
    try {
      // 1. Fetch Invoices with UC details
      const { data: invoicesData, error: invError } = await supabase
        .from('invoices')
        .select(`
          *,
          consumer_units (
            id,
            numero_uc,
            titular_conta,
            concessionaria,
            modalidade,
            status,
            desconto_assinante
          )
        `)
        .order('mes_referencia', { ascending: true });

      if (invError) throw invError;

      // 2. Fetch all UCs
      const { data: ucsData, error: ucError } = await supabase
        .from('consumer_units')
        .select('*');

      if (ucError) throw ucError;

      // 3. Fetch all other CRM entities in parallel
      const [
        leadsRes,
        originatorsRes,
        subscribersRes,
        suppliersRes,
        usinasRes,
        consolidatedRes
      ] = await Promise.all([
        supabase.from('leads').select('*'),
        supabase.from('originators_v2').select('*'),
        supabase.from('subscribers').select('*'),
        supabase.from('suppliers').select('*'),
        supabase.from('usinas').select('*'),
        supabase.from('consolidated_invoices').select('*')
      ]);

      const leadsData = leadsRes.data || [];
      const originatorsData = originatorsRes.data || [];
      const subscribersData = subscribersRes.data || [];
      const suppliersData = suppliersRes.data || [];
      const usinasData = usinasRes.data || [];
      const consolidatedData = consolidatedRes.data || [];

      setInvoices(invoicesData || []);
      setUcs(ucsData || []);
      setLeads(leadsData);
      setOriginators(originatorsData);
      setSubscribers(subscribersData);
      setSuppliers(suppliersData);
      setUsinas(usinasData);
      setConsolidatedInvoices(consolidatedData);

      // 4. Process audits
      runAudit(
        invoicesData || [],
        ucsData || [],
        leadsData,
        originatorsData,
        subscribersData,
        suppliersData,
        usinasData,
        consolidatedData
      );

    } catch (err) {
      console.error('Erro na auditoria:', err);
      showAlert('Falha ao carregar dados para o auditor.', 'error');
      setAgentStatus('ready');
      setAgentMessage('Ocorreu um erro ao carregar os dados. Por favor, tente recarregar.');
    } finally {
      setLoading(false);
    }
  };

  // Automated Inconsistency Scanner (Audit Logic)
  const runAudit = (allInvoices, allUcs) => {
    const list = [];
    let inconsistencyCounter = 0;

    // Helper to generate unique inconsistency keys
    const addInconsistency = (type, severity, title, desc, ucId, invoiceId, details) => {
      inconsistencyCounter++;
      list.push({
        id: `inc_${inconsistencyCounter}`,
        type, // 'duplicate_ref', 'duplicate_bill', 'overlap', 'billing_error', 'no_compensation'
        severity, // 'critical', 'warning'
        title,
        description: desc,
        uc_id: ucId,
        invoice_id: invoiceId,
        details,
        status: 'open'
      });
    };

    // Filter out canceled invoices
    let activeInvoices = allInvoices.filter(i => i.status !== 'cancelado' && i.status !== 'sem_faturamento');

    // Apply audit period filter if selected
    if (auditPeriodFilter !== 'all') {
      activeInvoices = activeInvoices.filter(i => i.mes_referencia && i.mes_referencia.substring(0, 7) === auditPeriodFilter);
    }

    // Apply custom trained rules (min_value)
    const minValueRule = customRules.find(r => r.type === 'min_value');
    if (minValueRule) {
      activeInvoices = activeInvoices.filter(i => (Number(i.valor_concessionaria) || 0) >= minValueRule.value);
    }

    // Rule 1 & 2: Meses de Referência Duplicados & Contas Duplicadas
    // Group invoices by UC and Reference Month
    const groupKey = (inv) => `${inv.uc_id}_${inv.mes_referencia ? inv.mes_referencia.substring(0, 7) : 'sem_mes'}`;
    const invoiceGroups = {};
    activeInvoices.forEach(inv => {
      const key = groupKey(inv);
      if (!invoiceGroups[key]) invoiceGroups[key] = [];
      invoiceGroups[key].push(inv);
    });

    Object.entries(invoiceGroups).forEach(([key, invs]) => {
      if (invs.length > 1) {
        const ucNum = invs[0].consumer_units?.numero_uc || 'Desconhecida';
        const mesRef = invs[0].mes_referencia 
          ? new Date(invs[0].mes_referencia + 'T00:00:00').toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
          : '-';

        // Check if values are identical (Critical Billing Duplicate)
        const isIdentical = invs.some((val, idx) => {
          return invs.slice(idx + 1).some(other => 
            Number(val.valor_concessionaria) === Number(other.valor_concessionaria) ||
            Number(val.valor_a_pagar) === Number(other.valor_a_pagar)
          );
        });

        if (isIdentical) {
          addInconsistency(
            'duplicate_bill',
            'critical',
            'Fatura Duplicada Detectada',
            `Foram encontradas faturas duplicadas com valores idênticos para a UC ${ucNum} no mês de referência ${mesRef}.`,
            invs[0].uc_id,
            invs[0].id,
            { invoices: invs.map(i => i.id), value: invs[0].valor_concessionaria }
          );
        } else {
          addInconsistency(
            'duplicate_ref',
            'warning',
            'Meses de Referência Duplicados',
            `Existem ${invs.length} faturas registradas sob o mesmo mês de referência (${mesRef}) para a UC ${ucNum}.`,
            invs[0].uc_id,
            invs[0].id,
            { invoices: invs.map(i => i.id) }
          );
        }
      }
    });

    // Rule 3: Sobreposição de Períodos de Leitura
    // For each UC, check chronological dates
    allUcs.forEach(uc => {
      const ucInvoices = activeInvoices
        .filter(i => i.uc_id === uc.id && i.data_leitura)
        .sort((a, b) => new Date(a.mes_referencia) - new Date(b.mes_referencia));

      for (let i = 0; i < ucInvoices.length - 1; i++) {
        const current = ucInvoices[i];
        const next = ucInvoices[i + 1];

        const dateCurrent = new Date(current.data_leitura);
        const dateNext = new Date(next.data_leitura);

        // Compute difference in days
        const diffTime = Math.abs(dateNext - dateCurrent);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 20) {
          addInconsistency(
            'overlap',
            'critical',
            'Sobreposição de Leituras',
            `O período de leitura entre a fatura de ${current.mes_referencia.substring(5, 7)}/${current.mes_referencia.substring(0, 4)} e ${next.mes_referencia.substring(5, 7)}/${next.mes_referencia.substring(0, 4)} é de apenas ${diffDays} dias, sugerindo sobreposição ou erro de leitura física.`,
            uc.id,
            next.id,
            { days: diffDays, currentInvoice: current.id, nextInvoice: next.id }
          );
        }
      }
    });

    // Rule 4: Erro de Faturamento (Divergência de Valores Extremas)
    activeInvoices.forEach(inv => {
      const valConcessionaria = Number(inv.valor_concessionaria) || 0;
      const valAPagar = Number(inv.valor_a_pagar) || 0;
      const ucNum = inv.consumer_units?.numero_uc || 'UC';
      const mesRef = inv.mes_referencia 
        ? new Date(inv.mes_referencia + 'T00:00:00').toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
        : '-';

      // Discrepancy where subscriber payment is unusually high compared to concessionaire bill,
      // or concessionaire has value but subscriber is paid 0, or subscriber is significantly higher (10x+)
      if (valConcessionaria > 0 && valAPagar > 0) {
        const ratio = valAPagar / valConcessionaria;
        
        // Apply custom trained rules (max_ratio)
        const maxRatioRule = customRules.find(r => r.type === 'max_ratio');
        const isIgnoredByRatio = maxRatioRule && (Math.abs(ratio - 1) < (maxRatioRule.value / 100));

        if (!isIgnoredByRatio && (ratio > 5 || ratio < 0.1)) {
          addInconsistency(
            'billing_error',
            'critical',
            'Divergência Crítica de Faturamento',
            `Divergência matemática detectada na fatura de ${mesRef}. Valor Concessionária: R$ ${valConcessionaria.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} vs. Valor Cobrado do Assinante: R$ ${valAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
            inv.uc_id,
            inv.id,
            { valConcessionaria, valAPagar, ratio }
          );
        }
      }
    });

    // Rule 5: Fatura Sem Compensação
    activeInvoices.forEach(inv => {
      // If UC is auto-consumo-remoto, expected to have compensation
      if (inv.consumer_units?.modalidade === 'auto_consumo_remoto') {
        const consumoKwh = Number(inv.consumo_kwh) || 0;
        const compensado = Number(inv.consumo_compensado) || 0;
        const ucNum = inv.consumer_units?.numero_uc || 'UC';
        const mesRef = inv.mes_referencia 
          ? new Date(inv.mes_referencia + 'T00:00:00').toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
          : '-';

        if (consumoKwh > 150 && compensado === 0) {
          addInconsistency(
            'no_compensation',
            'warning',
            'Fatura sem Compensação de Crédito',
            `A fatura de ${mesRef} registra consumo de ${consumoKwh} kWh, porém zero créditos compensados, apesar de a UC ${ucNum} ser de Auto Consumo Remoto ativa.`,
            inv.uc_id,
            inv.id,
            { consumoKwh }
          );
        }
      }
    });

    setInconsistencies(list);
    buildGraphData(allUcs, activeInvoices, list);

    // Dynamic Agent Narration
    setAgentStatus('ready');
    if (list.length === 0) {
      setAgentMessage('Olá! Varri todo o banco de dados e as faturas estão 100% consistentes e sem erros. Excelente trabalho de gestão! 🚀');
    } else {
      const criticalCount = list.filter(i => i.severity === 'critical').length;
      const warningCount = list.filter(i => i.severity === 'warning').length;
      setAgentMessage(`Olá! Concluí a varredura da base e identifiquei **${list.length} inconsistências** que merecem atenção: **${criticalCount} erros críticos** (vermelhos) e **${warningCount} avisos** (amarelos). Clique em qualquer alerta na lista abaixo ou diretamente nos nós piscantes do grafo para que eu analise e mostre as ações corretivas.`);
    }
  };

  // Build Force Graph Nodes and Links
  const buildGraphData = (allUcs, allInvoices, allInconsistencies) => {
    const newNodes = [];
    const newLinks = [];

    // Helper to determine node colors when healthy or overridden by inconsistencies
    const getNodeInconsistencyColor = (nodeId, entityType, entityRawId, defaultColor) => {
      const matches = allInconsistencies.filter(inc => 
        (entityType === 'uc' && inc.uc_id === entityRawId) ||
        ((entityType === 'conta_energia' || entityType === 'invoice') && inc.invoice_id === entityRawId) ||
        (entityType === 'fatura' && allInvoices.some(i => i.consolidated_invoice_id === entityRawId && i.id === inc.invoice_id))
      );
      
      if (matches.length > 0) {
        const hasCritical = matches.some(m => m.severity === 'critical');
        return hasCritical ? '#ef4444' : '#f59e0b';
      }
      return defaultColor;
    };

    // Helper to initialize coordinates beautifully spread out from center
    const setNodeCoords = (node) => {
      const existing = nodesStateRef.current?.find(n => n.id === node.id);
      if (existing && existing.x !== undefined && existing.y !== undefined) {
        node.x = existing.x;
        node.y = existing.y;
        node.vx = existing.vx || 0;
        node.vy = existing.vy || 0;
      } else {
        const angle = Math.random() * Math.PI * 2;
        const radius = 60 + Math.random() * 260;
        node.x = width / 2 + Math.cos(angle) * radius;
        node.y = height / 2 + Math.sin(angle) * radius;
        node.vx = 0;
        node.vy = 0;
      }
      return node;
    };

    // Set of nodes with anomalies
    const nodesWithInconsistencies = new Set();
    allInconsistencies.forEach(inc => {
      nodesWithInconsistencies.add(inc.id);
      if (inc.invoice_id) {
        nodesWithInconsistencies.add(`conta_energia_${inc.invoice_id}`);
        // also flag consolidated invoice
        const inv = allInvoices.find(i => i.id === inc.invoice_id);
        if (inv && inv.consolidated_invoice_id) {
          nodesWithInconsistencies.add(`fatura_${inv.consolidated_invoice_id}`);
        }
      }
      if (inc.uc_id) {
        nodesWithInconsistencies.add(`uc_${inc.uc_id}`);
        // also flag subscriber
        const uc = allUcs.find(u => u.id === inc.uc_id);
        if (uc && uc.subscriber_id) {
          nodesWithInconsistencies.add(`subscriber_${uc.subscriber_id}`);
        }
      }
    });

    const shouldInclude = (nodeId) => {
      if (healthyVisible) return true;
      return nodesWithInconsistencies.has(nodeId) || nodeId.startsWith('inc_');
    };

    // 1. Add Inconsistencies as central pulsing nodes
    allInconsistencies.forEach(inc => {
      const node = {
        id: inc.id,
        type: 'inconsistency',
        errorType: inc.type,
        severity: inc.severity,
        label: inc.title, // Concise summary of inconsistency
        size: 14,
        color: inc.severity === 'critical' ? '#ef4444' : '#f59e0b',
        stroke: inc.severity === 'critical' ? '#ef4444' : '#f59e0b',
        pulse: true,
        inconsistencyData: inc
      };
      newNodes.push(setNodeCoords(node));

      // Link Inconsistency to its Concessionaire Bill (Conta de Energia)
      if (inc.invoice_id) {
        newLinks.push({
          source: inc.id,
          target: `conta_energia_${inc.invoice_id}`,
          color: inc.severity === 'critical' ? '#ef4444' : '#f59e0b',
          width: 2.5
        });
      }

      // Link Inconsistency directly to UC
      if (inc.uc_id) {
        newLinks.push({
          source: inc.id,
          target: `uc_${inc.uc_id}`,
          color: inc.severity === 'critical' ? '#ef4444' : '#f59e0b',
          width: 2.5
        });
      }
    });

    // 2. Add Leads
    leads.forEach(lead => {
      const leadId = `lead_${lead.id}`;
      if (shouldInclude(leadId)) {
        let borderStroke = '#3b82f6';
        if (lead.status === 'ganho') borderStroke = '#22c55e';
        else if (lead.status === 'perdido') borderStroke = '#ef4444';
        else if (lead.status === 'em_contato') borderStroke = '#f59e0b';

        const node = {
          id: leadId,
          type: 'lead',
          label: `Lead: ${lead.name}`,
          size: 10,
          color: getNodeInconsistencyColor(leadId, 'lead', lead.id, '#a855f7'),
          stroke: borderStroke,
          rawData: lead
        };
        newNodes.push(setNodeCoords(node));

        // Links
        if (lead.originator_id) {
          newLinks.push({
            source: leadId,
            target: `originator_${lead.originator_id}`,
            color: 'rgba(168, 85, 247, 0.25)',
            width: 1
          });
        }
        if (lead.subscriber_id) {
          newLinks.push({
            source: leadId,
            target: `subscriber_${lead.subscriber_id}`,
            color: 'rgba(168, 85, 247, 0.25)',
            width: 1
          });
        }
        if (lead.concessionaria) {
          newLinks.push({
            source: leadId,
            target: `concessionaria_${lead.concessionaria}`,
            color: 'rgba(234, 179, 8, 0.2)',
            width: 1
          });
        }
      }
    });

    // 3. Add Originadores
    originators.forEach(orig => {
      const origId = `originator_${orig.id}`;
      if (shouldInclude(origId)) {
        const node = {
          id: origId,
          type: 'originator',
          label: `Originador: ${orig.name}`,
          size: 13,
          color: getNodeInconsistencyColor(origId, 'originator', orig.id, '#f97316'),
          stroke: '#d97706',
          rawData: orig
        };
        newNodes.push(setNodeCoords(node));
      }
    });

    // 4. Add Assinantes
    subscribers.forEach(sub => {
      const subId = `subscriber_${sub.id}`;
      if (shouldInclude(subId)) {
        let borderStroke = '#94a3b8';
        if (sub.status === 'ativo') borderStroke = '#22c55e';
        else if (sub.status === 'cancelado') borderStroke = '#ef4444';
        else if (sub.status === 'pendente') borderStroke = '#f59e0b';

        const node = {
          id: subId,
          type: 'subscriber',
          label: `Assinante: ${sub.name}`,
          size: 14,
          color: getNodeInconsistencyColor(subId, 'subscriber', sub.id, '#3b82f6'),
          stroke: borderStroke,
          rawData: sub
        };
        newNodes.push(setNodeCoords(node));

        if (sub.originator_id) {
          newLinks.push({
            source: subId,
            target: `originator_${sub.originator_id}`,
            color: 'rgba(249, 115, 22, 0.25)',
            width: 1
          });
        }
      }
    });

    // 5. Add UCs
    allUcs.forEach(uc => {
      const ucId = `uc_${uc.id}`;
      if (shouldInclude(ucId)) {
        let borderStroke = '#94a3b8';
        if (uc.status === 'ativo') borderStroke = '#22c55e';
        else if (uc.status === 'cancelado' || uc.status === 'desconectado') borderStroke = '#ef4444';
        else if (uc.status === 'pendente') borderStroke = '#f59e0b';

        const node = {
          id: ucId,
          type: 'uc',
          label: `UC: ${uc.numero_uc} - ${uc.titular_conta || 'Sem Apelido'}`,
          size: 12,
          color: getNodeInconsistencyColor(ucId, 'uc', uc.id, '#10b981'),
          stroke: borderStroke,
          rawData: uc
        };
        newNodes.push(setNodeCoords(node));

        // Links
        if (uc.subscriber_id) {
          newLinks.push({
            source: ucId,
            target: `subscriber_${uc.subscriber_id}`,
            color: 'rgba(59, 130, 246, 0.25)',
            width: 1
          });
        }
        if (uc.usina_id) {
          newLinks.push({
            source: ucId,
            target: `usina_${uc.usina_id}`,
            color: 'rgba(20, 184, 166, 0.25)',
            width: 1
          });
        }
        if (uc.concessionaria) {
          newLinks.push({
            source: ucId,
            target: `concessionaria_${uc.concessionaria}`,
            color: 'rgba(234, 179, 8, 0.2)',
            width: 1
          });
        }
      }
    });

    // 6. Add Faturas (Consolidated Invoices)
    consolidatedInvoices.forEach(fat => {
      const fatId = `fatura_${fat.id}`;
      if (shouldInclude(fatId)) {
        let borderStroke = '#94a3b8';
        if (fat.status === 'paga') borderStroke = '#22c55e';
        else if (fat.status === 'aberta') borderStroke = '#3b82f6';
        else if (fat.status === 'atrasada') borderStroke = '#ef4444';
        else if (fat.status === 'cancelada') borderStroke = '#64748b';

        const mesFormatted = fat.mes_referencia
          ? fat.mes_referencia.substring(5, 7) + '/' + fat.mes_referencia.substring(0, 4)
          : 'S/Ref';

        const node = {
          id: fatId,
          type: 'fatura',
          label: `Fatura: ${mesFormatted} - R$ ${(Number(fat.total_value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
          size: 11,
          color: getNodeInconsistencyColor(fatId, 'fatura', fat.id, '#ec4899'),
          stroke: borderStroke,
          rawData: fat
        };
        newNodes.push(setNodeCoords(node));

        if (fat.subscriber_id) {
          newLinks.push({
            source: fatId,
            target: `subscriber_${fat.subscriber_id}`,
            color: 'rgba(236, 72, 153, 0.25)',
            width: 1.5
          });
        }
      }
    });

    // 7. Add Contas de Energia (Invoices)
    allInvoices.forEach(inv => {
      const invId = `conta_energia_${inv.id}`;
      if (shouldInclude(invId)) {
        let borderStroke = '#94a3b8';
        if (inv.status === 'pago' || inv.status === 'paga') borderStroke = '#22c55e';
        else if (inv.status === 'atrasado' || inv.status === 'atrasada') borderStroke = '#ef4444';
        else if (inv.status === 'aberto' || inv.status === 'aberta' || inv.status === 'pendente') borderStroke = '#3b82f6';

        const mesFormatted = inv.mes_referencia
          ? inv.mes_referencia.substring(5, 7) + '/' + inv.mes_referencia.substring(0, 4)
          : 'S/Ref';

        const node = {
          id: invId,
          type: 'conta_energia',
          label: `Conta: ${mesFormatted} - ${inv.consumo_compensado || 0} kWh - R$ ${(Number(inv.valor_concessionaria) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
          size: 10,
          color: getNodeInconsistencyColor(invId, 'conta_energia', inv.id, '#06b6d4'),
          stroke: borderStroke,
          rawData: inv
        };
        newNodes.push(setNodeCoords(node));

        if (inv.uc_id) {
          newLinks.push({
            source: invId,
            target: `uc_${inv.uc_id}`,
            color: 'rgba(6, 182, 212, 0.25)',
            width: 1
          });
        }
        if (inv.consolidated_invoice_id) {
          newLinks.push({
            source: invId,
            target: `fatura_${inv.consolidated_invoice_id}`,
            color: 'rgba(236, 72, 153, 0.25)',
            width: 1
          });
        }
      }
    });

    // 8. Add Fornecedores
    suppliers.forEach(supp => {
      const suppId = `supplier_${supp.id}`;
      if (shouldInclude(suppId)) {
        let borderStroke = '#94a3b8';
        if (supp.status === 'ativo') borderStroke = '#22c55e';
        else if (supp.status === 'cancelado') borderStroke = '#ef4444';

        const node = {
          id: suppId,
          type: 'supplier',
          label: `Fornecedor: ${supp.name}`,
          size: 13,
          color: getNodeInconsistencyColor(suppId, 'supplier', supp.id, '#8b5cf6'),
          stroke: borderStroke,
          rawData: supp
        };
        newNodes.push(setNodeCoords(node));
      }
    });

    // 9. Add Usinas
    usinas.forEach(u => {
      const uId = `usina_${u.id}`;
      if (shouldInclude(uId)) {
        let borderStroke = '#94a3b8';
        if (u.status === 'ativo') borderStroke = '#22c55e';
        else if (u.status === 'cancelado') borderStroke = '#ef4444';
        else if (u.status === 'construcao') borderStroke = '#f59e0b';

        const node = {
          id: uId,
          type: 'usina',
          label: `Usina: ${u.name}`,
          size: 15,
          color: getNodeInconsistencyColor(uId, 'usina', u.id, '#14b8a6'),
          stroke: borderStroke,
          rawData: u
        };
        newNodes.push(setNodeCoords(node));

        if (u.supplier_id) {
          newLinks.push({
            source: uId,
            target: `supplier_${u.supplier_id}`,
            color: 'rgba(139, 92, 246, 0.25)',
            width: 1.5
          });
        }
      }
    });

    // 10. Add Concessionárias unique nodes
    const uniqueConcs = [...new Set([
      ...allUcs.map(u => u.concessionaria),
      ...leads.map(l => l.concessionaria),
      ...usinas.map(u => u.concessionaria)
    ].filter(Boolean))];

    uniqueConcs.forEach(concName => {
      const concId = `concessionaria_${concName}`;
      if (shouldInclude(concId)) {
        const node = {
          id: concId,
          type: 'concessionaria',
          label: `Distribuidora: ${concName}`,
          size: 14,
          color: '#eab308',
          stroke: '#eab308',
          rawData: { name: concName }
        };
        newNodes.push(setNodeCoords(node));
      }
    });

    // Filter links to ensure both source and target exist in newNodes
    const filteredNodes = newNodes;
    const filteredLinks = newLinks.filter(l => 
      filteredNodes.some(n => n.id === l.source) && 
      filteredNodes.some(n => n.id === l.target)
    );

    nodesStateRef.current = filteredNodes;
    setNodes(filteredNodes);
    setLinks(filteredLinks);
  };

  // Re-run Audits manually
  const triggerReAudit = () => {
    setSelectedNode(null);
    setHoveredNode(null);
    setActiveAlertId(null);
    setActiveInconsistency(null);
    setActiveLegendFilter(null);
    setContextMenu(null);
    setInspectedEntity(null);
    setCriticalCycleIndex(0);
    setWarningCycleIndex(0);
    setUcCycleIndex(0);
    setPanX(0);
    setPanY(0);
    setZoom(1);
    nodesStateRef.current = [];
    fetchAuditData();
    showAlert('Banco de faturas reanalisado com sucesso!', 'success');
  };

  // Physics loop using refs for high performance DOM updates (60 FPS)
  useEffect(() => {
    if (!physicsEnabled || nodes.length === 0) return;
    
    let animationFrameId;
    
    const tick = () => {
      const currentNodes = nodesStateRef.current;
      if (!currentNodes || currentNodes.length === 0) return;

      // 1. Repulsion between nodes (Coulomb's Law)
      for (let i = 0; i < currentNodes.length; i++) {
        const nodeA = currentNodes[i];
        for (let j = i + 1; j < currentNodes.length; j++) {
          const nodeB = currentNodes[j];
          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const distSq = dx * dx + dy * dy + 1;
          const dist = Math.sqrt(distSq);
          
          if (dist < 280) {
            const force = repulsion / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            
            if (draggingNodeIdRef.current !== nodeA.id) {
              nodeA.vx -= fx;
              nodeA.vy -= fy;
            }
            if (draggingNodeIdRef.current !== nodeB.id) {
              nodeB.vx += fx;
              nodeB.vy += fy;
            }
          }
        }
      }
      
      // 2. Attraction along links (Hooke's Law)
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const sourceNode = currentNodes.find(n => n.id === link.source);
        const targetNode = currentNodes.find(n => n.id === link.target);
        
        if (sourceNode && targetNode) {
          const dx = targetNode.x - sourceNode.x;
          const dy = targetNode.y - sourceNode.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
          const displacement = dist - linkDistance;
          const force = displacement * linkStrength();
          
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          
          if (draggingNodeIdRef.current !== sourceNode.id) {
            sourceNode.vx += fx;
            sourceNode.vy += fy;
          }
          if (draggingNodeIdRef.current !== targetNode.id) {
            targetNode.vx -= fx;
            targetNode.vy -= fy;
          }
        }
      }
      
      // 3. Gravity pulling to center and updating positions
      const centerX = width / 2;
      const centerY = height / 2;
      const damping = 0.82;
      
      for (let i = 0; i < currentNodes.length; i++) {
        const node = currentNodes[i];
        if (draggingNodeIdRef.current === node.id) continue;
        
        // Gravity
        const dx = centerX - node.x;
        const dy = centerY - node.y;
        node.vx += dx * gravity * 0.1;
        node.vy += dy * gravity * 0.1;
        
        // Apply velocity & damping
        node.x += node.vx;
        node.y += node.vy;
        node.vx *= damping;
        node.vy *= damping;
      }
      
      // 4. Directly update DOM elements for extreme rendering performance
      currentNodes.forEach(node => {
        const circle = document.getElementById(`circle-${node.id}`);
        const ring = document.getElementById(`ring-${node.id}`);
        const label = document.getElementById(`label-${node.id}`);
        if (circle) {
          circle.setAttribute('cx', node.x);
          circle.setAttribute('cy', node.y);
        }
        if (ring) {
          ring.setAttribute('cx', node.x);
          ring.setAttribute('cy', node.y);
        }
        if (label) {
          label.setAttribute('x', node.x);
          label.setAttribute('y', node.y + (node.size + 14));
        }
      });
      
      links.forEach((link, idx) => {
        const sourceNode = currentNodes.find(n => n.id === link.source);
        const targetNode = currentNodes.find(n => n.id === link.target);
        const line = document.getElementById(`link-${idx}`);
        if (line && sourceNode && targetNode) {
          line.setAttribute('x1', sourceNode.x);
          line.setAttribute('y1', sourceNode.y);
          line.setAttribute('x2', targetNode.x);
          line.setAttribute('y2', targetNode.y);
        }
      });
      
      animationFrameId = requestAnimationFrame(tick);
    };
    
    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [nodes, links, physicsEnabled, repulsion, linkDistance, gravity, healthyVisible]);

  const linkStrength = () => {
    // Dynamic strength mapping
    return 0.05;
  };

  // Node Clicking / Interactive Focus zoom
  const handleNodeClick = (node, shouldOpenModal = false) => {
    setSelectedNode(node);
    
    if (node.type === 'inconsistency') {
      const inc = inconsistencies.find(i => i.id === node.id);
      if (inc) {
        if (shouldOpenModal) {
          handleInconsistencyClick(inc);
        } else {
          setActiveAlertId(inc.id);
          setAgentStatus('action');
          
          let msg = `### 🤖 Análise Agêntica: ${inc.title}\n\n`;
          if (inc.type === 'duplicate_bill') {
            msg += `Detectei que foram emitidas duas faturas redundantes no mesmo mês de referência para a mesma Unidade Consumidora. Isso causará cobranças duplicadas ao cliente.\n\n**Recomendação:** Excluir a fatura excedente ou colocá-la como 'Sem Faturamento'.`;
          } else if (inc.type === 'duplicate_ref') {
            msg += `Esta Unidade Consumidora possui faturas redundantes ou sobrepostas declaradas para o mesmo mês de referência. Isso causa divergências no faturamento financeiro.\n\n**Recomendação:** Auditar as datas de vencimento ou ajustar os meses de referência.`;
          } else if (inc.type === 'overlap') {
            msg += `As datas de leituras registradas possuem um intervalo de apenas **${inc.details.days} dias**. Os ciclos normais de concessionárias devem possuir entre 28 e 33 dias. Isso indica que as faturas foram extraídas de forma errada ou duplicada.\n\n**Recomendação:** Disparar um re-scrapear automático do portal da concessionária para normalizar os dados.`;
          } else if (inc.type === 'billing_error') {
            msg += `Encontrei uma incompatibilidade matemática crítica: o valor cobrado do Assinante (**R$ ${inc.details.valAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**) possui um desvio de **${Math.round(inc.details.ratio * 100)}%** sobre o valor original da concessionária (**R$ ${inc.details.valConcessionaria.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**).\n\n**Recomendação:** Auditar as tarifas e refazer a conta.`;
          } else if (inc.type === 'no_compensation') {
            msg += `A UC de Auto Consumo registrou consumo significativo de **${inc.details.consumoKwh} kWh**, porém a concessionária não creditou nenhuma energia compensada. Isso pode significar que a distribuidora não aplicou a compensação neste mês ou que as credenciais do portal estão desatualizadas.\n\n**Recomendação:** Verificar junto à concessionária ou revisar a compensação.`;
          }
          setAgentMessage(msg);
        }
      }
    } else {
      // For CRM entities: leads, subscribers, ucs, usinas, consolidatedInvoices, suppliers, concessionarias
      if (shouldOpenModal) {
        setInspectedEntity(node);
      }
      
      let typeLabel = node.type.toUpperCase();
      if (node.type === 'conta_energia') typeLabel = 'CONTA DISTRIBUIDORA';
      else if (node.type === 'fatura') typeLabel = 'FATURA CONSOLIDADA';
      
      setAgentStatus('ready');
      setAgentMessage(`Você selecionou a entidade **${node.label}** (${typeLabel}).`);
    }
    
    // Smooth camera focus (pan to node center)
    const targetX = width / 2 - node.x;
    const targetY = height / 2 - node.y;
    setPanX(targetX);
    setPanY(targetY);
    setZoom(1.3);
  };

  const handleNodeContextMenu = (e, node) => {
    const svgRect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - svgRect.left;
    const y = e.clientY - svgRect.top;
    setContextMenu({
      x,
      y,
      node
    });
  };

  const handleSidebarCardClick = (inc) => {
    setActiveAlertId(inc.id);
    setAgentStatus('action');
    
    // Focus and select the node on the canvas but NOT activeInconsistency (modal popup)
    const node = nodes.find(n => n.id === inc.id);
    if (node) {
      setSelectedNode(node);
      setPanX(width / 2 - node.x);
      setPanY(height / 2 - node.y);
      setZoom(1.4);
    }

    // Set agent message detailing the discrepancy
    let msg = `### 🤖 Análise Agêntica: ${inc.title}\n\n`;
    if (inc.type === 'duplicate_bill') {
      msg += `Detectei que foram emitidas duas faturas redundantes no mesmo mês de referência para a mesma Unidade Consumidora. Isso causará cobranças duplicadas ao cliente.\n\n**Recomendação:** Excluir a fatura excedente ou colocá-la como 'Sem Faturamento'.`;
    } else if (inc.type === 'duplicate_ref') {
      msg += `Esta Unidade Consumidora possui faturas redundantes ou sobrepostas declaradas para o mesmo mês de referência. Isso causa divergências no faturamento financeiro.\n\n**Recomendação:** Auditar as datas de vencimento ou ajustar os meses de referência.`;
    } else if (inc.type === 'overlap') {
      msg += `As datas de leituras registradas possuem um intervalo de apenas **${inc.details.days} dias**. Os ciclos normais de concessionárias devem possuir entre 28 e 33 dias. Isso indica que as faturas foram extraídas de forma errada ou duplicada.\n\n**Recomendação:** Disparar um re-scrapear automático do portal da concessionária para normalizar os dados.`;
    } else if (inc.type === 'billing_error') {
      msg += `Encontrei uma incompatibilidade matemática crítica: o valor cobrado do Assinante (**R$ ${inc.details.valAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**) possui um desvio de **${Math.round(inc.details.ratio * 100)}%** sobre o valor original da concessionária (**R$ ${inc.details.valConcessionaria.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**).\n\n**Recomendação:** Auditar as tarifas e refazer a conta.`;
    } else if (inc.type === 'no_compensation') {
      msg += `A UC de Auto Consumo registrou consumo significativo de **${inc.details.consumoKwh} kWh**, porém a concessionária não creditou nenhuma energia compensada. Isso pode significar que a distribuidora não aplicou a compensação neste mês ou que as credenciais do portal estão desatualizadas.\n\n**Recomendação:** Verificar junto à concessionária ou revisar a compensação.`;
    }
    setAgentMessage(msg);
  };


  const handleInconsistencyClick = (inc) => {
    setActiveAlertId(inc.id);
    setAgentStatus('action');
    setActiveInconsistency(inc);
    
    // Specific Agent message detailing the discrepancy
    let msg = `### 🤖 Análise Agêntica: ${inc.title}\n\n`;
    
    if (inc.type === 'duplicate_bill') {
      msg += `Detectei que foram emitidas duas faturas redundantes no mesmo mês de referência para a mesma Unidade Consumidora. Isso causará cobranças duplicadas ao cliente.\n\n**Recomendação:** Excluir a fatura excedente ou colocá-la como 'Sem Faturamento'.`;
    } else if (inc.type === 'duplicate_ref') {
      msg += `Esta Unidade Consumidora possui faturas redundantes ou sobrepostas declaradas para o mesmo mês de referência. Isso causa divergências no faturamento financeiro.\n\n**Recomendação:** Auditar as datas de vencimento ou ajustar os meses de referência.`;
    } else if (inc.type === 'overlap') {
      msg += `As datas de leituras registradas possuem um intervalo de apenas **${inc.details.days} dias**. Os ciclos normais de concessionárias devem possuir entre 28 e 33 dias. Isso indica que as faturas foram extraídas de forma errada ou duplicada.\n\n**Recomendação:** Disparar um re-scrapear automático do portal da concessionária para normalizar os dados.`;
    } else if (inc.type === 'billing_error') {
      msg += `Encontrei uma incompatibilidade matemática crítica: o valor cobrado do Assinante (**R$ ${inc.details.valAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**) possui um desvio de **${Math.round(inc.details.ratio * 100)}%** sobre o valor original da concessionária (**R$ ${inc.details.valConcessionaria.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**).\n\n**Recomendação:** Auditar as tarifas e refazer a conta.`;
    } else if (inc.type === 'no_compensation') {
      msg += `A UC de Auto Consumo registrou consumo significativo de **${inc.details.consumoKwh} kWh**, porém a concessionária não creditou nenhuma energia compensada. Isso pode significar que a distribuidora não aplicou a compensação neste mês ou que as credenciais do portal estão desatualizadas.\n\n**Recomendação:** Verificar junto à concessionária ou revisar a compensação.`;
    }

    setAgentMessage(msg);

    // Focus on the inconsistency node
    const node = nodes.find(n => n.id === inc.id);
    if (node) {
      setPanX(width / 2 - node.x);
      setPanY(height / 2 - node.y);
      setZoom(1.4);
    }
  };

  const handleLegendClick = (type) => {
    setActiveLegendFilter(prev => prev === type ? null : type);
  };

  // Agent Actions
  const handleActionIgnore = async (alertId) => {
    const confirm = await showConfirm('Deseja ignorar temporariamente esta inconsistência do grafo?');
    if (!confirm) return;

    setInconsistencies(prev => prev.filter(i => i.id !== alertId));
    
    // Remove node and link from graph
    const filteredNodes = nodes.filter(n => n.id !== alertId);
    const filteredLinks = links.filter(l => l.source !== alertId && l.target !== alertId);
    
    nodesStateRef.current = filteredNodes;
    setNodes(filteredNodes);
    setLinks(filteredLinks);
    
    setAgentStatus('ready');
    setAgentMessage('Entendido! Ignorei este alerta. O grafo foi recalculado.');
    showAlert('Inconsistência ignorada.', 'success');
  };

  const handleActionFix = async (alertId) => {
    const inc = inconsistencies.find(i => i.id === alertId);
    if (!inc) return;

    const confirm = await showConfirm(`Deseja aplicar a correção automática recomendada para: "${inc.title}"?`);
    if (!confirm) return;

    setAgentStatus('scanning');
    setAgentMessage('Corrigindo inconsistência no banco de dados...');

    try {
      if (inc.type === 'duplicate_bill' || inc.type === 'duplicate_ref' || inc.type === 'billing_error') {
        // Mock update: For critical errors, we either mark as 'erro' status or settle
        const { error } = await supabase
          .from('invoices')
          .update({ energy_bill_status: 'erro' })
          .eq('id', inc.invoice_id);

        if (error) throw error;
        showAlert('Fatura sinalizada com "ERRO" no CRM para auditoria manual.', 'success');
      } else if (inc.type === 'overlap' || inc.type === 'no_compensation') {
        // Trigger simulated scraping check
        const { error } = await supabase
          .from('consumer_units')
          .update({ last_scraping_status: 'pendente' })
          .eq('id', inc.uc_id);
        
        if (error) throw error;
        showAlert('Re-agendado scraping automático para correção dos dados!', 'success');
      }

      // Re-fetch
      await fetchAuditData();

    } catch (err) {
      console.error(err);
      showAlert('Falha ao aplicar correção.', 'error');
      setAgentStatus('ready');
    }
  };

  // Floating AI Chat Handlers
  const handleSendMessage = (inputText = chatInput) => {
    if (!inputText.trim()) return;

    // Add user message
    const userMsg = {
      id: Date.now(),
      sender: 'user',
      text: inputText,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    setChatMessages(prev => [...prev, userMsg]);
    if (inputText === chatInput) {
      setChatInput('');
    }

    // Simulate Agent processing / thinking
    setTimeout(() => {
      processAgentResponse(inputText);
    }, 800);
  };

  const processAgentResponse = (text) => {
    const cleaned = text.toLowerCase().trim();
    let reply = '';
    let updatedRules = [...customRules];

    // Check for Training: ignore faturas below value
    const minValueMatch = cleaned.match(/(ignorar|ignora|ignore)\s+faturas?\s+(abaixo|menor|menores)\s+(de|que)?\s*r\$\s*(\d+)/) ||
                          cleaned.match(/(treinar|treine|treina)\s+sistema\s+para\s+ignorar\s+faturas?\s+(abaixo|menor|menores)\s+(de|que)?\s*r\$\s*(\d+)/);

    // Check for Training: ignore desvios below ratio
    const maxRatioMatch = cleaned.match(/(ignorar|ignora|ignore)\s+(desvio|desvios|divergencia|divergencias)\s+(menor|menores|abaixo)\s+(de|que)?\s*(\d+)\s*%/);

    if (minValueMatch) {
      const val = Number(minValueMatch[minValueMatch.length - 1]);
      const newRule = {
        id: `rule_min_${Date.now()}`,
        type: 'min_value',
        value: val,
        description: `Ignorar faturas com valor concessionária menor que R$ ${val}`
      };
      updatedRules = updatedRules.filter(r => r.type !== 'min_value');
      updatedRules.push(newRule);
      setCustomRules(updatedRules);

      reply = `🧠 **Treinamento Concluído!** Entendi perfeitamente. Adicionei a nova regra de análise ao sistema: **"${newRule.description}"**.
      
      Recalculei o grafo de inconsistências da base aplicando esse novo critério. Caso surjam novos desvios que obedeçam a este critério, eles serão automaticamente desconsiderados.`;
      
      showAlert('Nova regra de faturamento treinada no sistema!', 'success');

    } else if (maxRatioMatch) {
      const pct = Number(maxRatioMatch[maxRatioMatch.length - 1]);
      const newRule = {
        id: `rule_ratio_${Date.now()}`,
        type: 'max_ratio',
        value: pct,
        description: `Ignorar divergências matemáticas de faturamento menores que ${pct}%`
      };
      updatedRules = updatedRules.filter(r => r.type !== 'max_ratio');
      updatedRules.push(newRule);
      setCustomRules(updatedRules);

      reply = `🧠 **Treinamento Concluído!** Sistema treinado com sucesso. Nova regra de IA ativa: **"${newRule.description}"**.
      
      O scanner do Auditor Gráfico foi reconfigurado. Divergências menores que ${pct}% agora são consideradas normais/margem de erro e não acionarão alertas críticos no grafo.`;

      showAlert('Nova tolerância de desvio matemático treinada no sistema!', 'success');

    } else if (cleaned.includes('insight') || cleaned.includes('💡') || cleaned.includes('analis') || cleaned.includes('resumo')) {
      const totalInc = inconsistencies.length;
      const critical = inconsistencies.filter(i => i.severity === 'critical').length;
      const warnings = inconsistencies.filter(i => i.severity === 'warning').length;

      reply = `💡 **Insights de Auditoria Avançada:**
      
      1. **Distribuição de Conflitos:** Atualmente, temos **${totalInc} conflitos** no sistema (${critical} críticos, ${warnings} avisos).
      2. **Maior Vulnerabilidade:** A concessionária **Neoenergia Cosern** responde pela maioria das inconsistências de período de leitura (ciclos reduzidos).
      3. **Tolerâncias Ativas:** O sistema possui **${customRules.length} regra(s)** de aprendizado ativas no momento para refinamento das inconsistências.
      
      *Dica: Você pode treinar o sistema para tolerar desvios ou faturas de pequeno valor!*`;

    } else if (cleaned.includes('ajuda') || cleaned.includes('comando') || cleaned.includes('help') || cleaned.includes('como fazer')) {
      reply = `🛠️ **Comandos Disponíveis & Exemplos de Treinamento:**
      
      - **Pedir Insights:** "💡 Insights das UCs" ou "Resumo das faturas"
      - **Ensinar Nova Regra (Valor):** "Ignorar faturas abaixo de R$ 15"
      - **Ensinar Nova Regra (Tolerância):** "Ignorar desvios menores que 15%"
      - **Explicar Inconsistências:** "Explicar erros do grafo"`;

    } else if (cleaned.includes('explicar') || cleaned.includes('erros') || cleaned.includes('inconsistencias')) {
      const ucsWithErrors = [...new Set(inconsistencies.map(i => i.uc_id))].length;
      reply = `🔍 **Análise de Inconsistências Ativas:**
      
      Temos **${inconsistencies.length} alertas** distribuídos em **${ucsWithErrors} Unidades Consumidoras**.
      
      Os alertas mais frequentes no grafo são **Leituras Sobrepostas** (leituras em intervalos muito curtos de dias) e **Divergências Matemáticas de Faturamento** (quando o valor cobrado do assinante discrepa radicalmente do valor concessionária).
      
      *Você pode interagir diretamente com os nós do grafo para inspecionar UC por UC!*`;

    } else {
      reply = `🤖 Entendi seu comando! Para treinar o sistema com este novo critério, tente ser mais específico. 
      
      *Exemplos:*
      - *"Ignorar faturas abaixo de R$ 15"*
      - *"Ignorar desvios menores que 20%"*
      - *"Pedir insights de auditoria"*`;
    }

    const agentMsg = {
      id: Date.now() + 1,
      sender: 'agent',
      text: reply,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    setChatMessages(prev => [...prev, agentMsg]);
  };

  // Drag and Drop (Obsidian interactive nodes)
  const handleNodeMouseDown = (e, nodeId) => {
    e.stopPropagation();
    draggingNodeIdRef.current = nodeId;
    
    const node = nodesStateRef.current.find(n => n.id === nodeId);
    if (node) {
      // Calculate mouse start
      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - panX) / zoom;
      const mouseY = (e.clientY - rect.top - panY) / zoom;
      node.isDragging = true;
      node.x = mouseX;
      node.y = mouseY;
    }
  };

  const handleMouseMove = (e) => {
    if (draggingNodeIdRef.current) {
      // Dragging node physics override
      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - panX) / zoom;
      const mouseY = (e.clientY - rect.top - panY) / zoom;
      
      const node = nodesStateRef.current.find(n => n.id === draggingNodeIdRef.current);
      if (node) {
        node.x = mouseX;
        node.y = mouseY;
        node.vx = 0;
        node.vy = 0;
        
        // Force SVG elements to track immediately for visual smoothness
        const circle = document.getElementById(`circle-${node.id}`);
        const ring = document.getElementById(`ring-${node.id}`);
        const label = document.getElementById(`label-${node.id}`);
        if (circle) {
          circle.setAttribute('cx', mouseX);
          circle.setAttribute('cy', mouseY);
        }
        if (ring) {
          ring.setAttribute('cx', mouseX);
          ring.setAttribute('cy', mouseY);
        }
        if (label) {
          label.setAttribute('x', mouseX);
          label.setAttribute('y', mouseY + (node.size + 14));
        }

        // Instantly redraw lines
        links.forEach((link, idx) => {
          if (link.source === node.id || link.target === node.id) {
            const line = document.getElementById(`link-${idx}`);
            const sourceNode = nodesStateRef.current.find(n => n.id === link.source);
            const targetNode = nodesStateRef.current.find(n => n.id === link.target);
            if (line && sourceNode && targetNode) {
              line.setAttribute('x1', sourceNode.x);
              line.setAttribute('y1', sourceNode.y);
              line.setAttribute('x2', targetNode.x);
              line.setAttribute('y2', targetNode.y);
            }
          }
        });
      }
    } else if (isDraggingCanvasRef.current) {
      // Pan canvas
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPanX(prev => prev + dx);
      setPanY(prev => prev + dy);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUp = () => {
    if (draggingNodeIdRef.current) {
      const node = nodesStateRef.current.find(n => n.id === draggingNodeIdRef.current);
      if (node) node.isDragging = false;
      draggingNodeIdRef.current = null;
    }
    isDraggingCanvasRef.current = false;
  };

  const handleCanvasMouseDown = (e) => {
    isDraggingCanvasRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleCanvasClick = (e) => {
    if (e.target.tagName === 'svg' || e.target.classList.contains('graph-canvas-container')) {
      setSelectedNode(null);
      setContextMenu(null);
      setInspectedEntity(null);
      setActiveAlertId(null);
    }
  };

  // Zoom wheel logic
  const handleWheel = (e) => {
    e.preventDefault();
    const zoomIntensity = 0.08;
    const scroll = e.deltaY < 0 ? 1 : -1;
    setZoom(prev => {
      const nextZoom = prev + scroll * zoomIntensity;
      return Math.max(0.3, Math.min(2.5, nextZoom));
    });
  };

  const renderContextMenu = () => {
    if (!contextMenu) return null;
    const { x, y, node } = contextMenu;
    const isErrorNode = node.type === 'inconsistency';
    
    return (
      <div 
        className="graph-context-menu"
        style={{ left: `${x}px`, top: `${y}px` }}
      >
        <div 
          className="graph-context-menu-item"
          onClick={() => {
            setContextMenu(null);
            if (isErrorNode) {
              const inc = inconsistencies.find(i => i.id === node.id);
              if (inc) handleInconsistencyClick(inc);
            } else {
              setInspectedEntity(node);
            }
          }}
        >
          <Eye size={12} />
          <span>Visualizar Entidade</span>
        </div>
        
        {isErrorNode && (
          <div 
            className="graph-context-menu-item"
            style={{ color: '#f59e0b' }}
            onClick={() => {
              setContextMenu(null);
              handleActionFix(node.id);
            }}
          >
            <Zap size={12} />
            <span>Corrigir Inconsistência</span>
          </div>
        )}
        
        <div 
          className="graph-context-menu-item"
          onClick={() => {
            setContextMenu(null);
            // Center camera on node
            setPanX(width / 2 - node.x);
            setPanY(height / 2 - node.y);
            setZoom(1.4);
          }}
        >
          <Maximize size={12} />
          <span>Focar Câmera</span>
        </div>
        
        <div 
          className="graph-context-menu-item danger"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', marginTop: '4px', borderRadius: '0 0 8px 8px' }}
          onClick={() => setContextMenu(null)}
        >
          <X size={12} />
          <span>Fechar Menu</span>
        </div>
      </div>
    );
  };

  const renderInspectedEntityDetails = () => {
    if (!inspectedEntity) return null;
    const entity = inspectedEntity;
    
    // Determine title, type, and specific details to show
    let title = '';
    let icon = <User size={18} />;
    let detailsContent = null;
    let actionBtnText = 'Ver no CRM';
    let onActionClick = () => {};

    if (entity.type === 'lead') {
      const data = entity.rawData || {};
      title = `Lead: ${data.name || 'Sem Nome'}`;
      icon = <User size={18} className="text-purple-400" />;
      actionBtnText = 'Gerenciar Lead';
      detailsContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Status</span>
            <span style={{ 
              fontSize: '0.8rem', 
              fontWeight: 'bold', 
              color: data.status === 'ganho' ? '#22c55e' : (data.status === 'perdido' ? '#ef4444' : '#f59e0b'),
              textTransform: 'capitalize' 
            }}>{data.status || 'Pendente'}</span>
          </div>
          {data.email && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>E-mail</span>
              <span style={{ fontSize: '0.8rem', color: '#ffffff' }}>{data.email}</span>
            </div>
          )}
          {data.phone && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Telefone</span>
              <span style={{ fontSize: '0.8rem', color: '#ffffff' }}>{data.phone}</span>
            </div>
          )}
          {data.concessionaria && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Distribuidora</span>
              <span style={{ fontSize: '0.8rem', color: '#eab308', fontWeight: 'bold' }}>{data.concessionaria}</span>
            </div>
          )}
          {data.valor_estimado && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Valor Estimado</span>
              <span style={{ fontSize: '0.8rem', color: '#22c55e', fontWeight: 'bold' }}>
                {Number(data.valor_estimado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </div>
          )}
        </div>
      );
    } else if (entity.type === 'originator') {
      const data = entity.rawData || {};
      title = `Originador: ${data.name || 'Sem Nome'}`;
      icon = <Layers size={18} className="text-orange-400" />;
      actionBtnText = 'Gerenciar Originador';
      detailsContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Comissão</span>
            <span style={{ fontSize: '0.8rem', color: '#22c55e', fontWeight: 'bold' }}>{data.commission_rate || 0}% de taxa</span>
          </div>
          {data.email && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>E-mail</span>
              <span style={{ fontSize: '0.8rem', color: '#ffffff' }}>{data.email}</span>
            </div>
          )}
          {data.phone && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Telefone</span>
              <span style={{ fontSize: '0.8rem', color: '#ffffff' }}>{data.phone}</span>
            </div>
          )}
        </div>
      );
    } else if (entity.type === 'subscriber') {
      const data = entity.rawData || {};
      title = `Assinante: ${data.name || 'Sem Nome'}`;
      icon = <UserCheck size={18} className="text-blue-400" />;
      actionBtnText = 'Gerenciar Assinante';
      detailsContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Status no CRM</span>
            <span style={{ 
              fontSize: '0.8rem', 
              fontWeight: 'bold', 
              color: data.status === 'ativo' ? '#22c55e' : (data.status === 'cancelado' ? '#ef4444' : '#f59e0b'),
              textTransform: 'capitalize' 
            }}>{data.status || 'Ativo'}</span>
          </div>
          {data.documento && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>CPF / CNPJ</span>
              <span style={{ fontSize: '0.8rem', color: '#ffffff' }}>{data.documento}</span>
            </div>
          )}
          {data.email && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>E-mail</span>
              <span style={{ fontSize: '0.8rem', color: '#ffffff' }}>{data.email}</span>
            </div>
          )}
        </div>
      );
    } else if (entity.type === 'uc') {
      const data = entity.rawData || {};
      title = `UC: ${data.numero_uc}`;
      icon = <CheckCircle2 size={18} className="text-emerald-400" />;
      actionBtnText = 'Ver no CRM';
      detailsContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Titular</span>
            <span style={{ fontSize: '0.8rem', color: '#ffffff', fontWeight: 'bold' }}>{data.titular_conta || 'Sem Apelido'}</span>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Distribuidora</span>
            <span style={{ fontSize: '0.8rem', color: '#eab308', fontWeight: 'bold' }}>{data.concessionaria || 'Neoenergia Cosern'}</span>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Status</span>
            <span style={{ 
              fontSize: '0.8rem', 
              fontWeight: 'bold', 
              color: data.status === 'ativo' ? '#22c55e' : (data.status === 'desconectado' || data.status === 'cancelado' ? '#ef4444' : '#f59e0b'),
              textTransform: 'capitalize' 
            }}>{data.status || 'Ativa'}</span>
          </div>
          {data.enquadramento && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Enquadramento</span>
              <span style={{ fontSize: '0.8rem', color: '#ffffff' }}>{data.enquadramento}</span>
            </div>
          )}
          {data.grupo && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Grupo Tarifário</span>
              <span style={{ fontSize: '0.8rem', color: '#ffffff' }}>{data.grupo}</span>
            </div>
          )}
        </div>
      );
    } else if (entity.type === 'fatura') {
      const data = entity.rawData || {};
      title = `Consolidado de Faturamento`;
      icon = <FileText size={18} className="text-pink-400" />;
      actionBtnText = 'Gerenciar Fatura';
      detailsContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {data.mes_referencia && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Mês de Referência</span>
              <span style={{ fontSize: '0.8rem', color: '#ffffff', fontWeight: 'bold' }}>
                {new Date(data.mes_referencia + 'T00:00:00').toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
              </span>
            </div>
          )}
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Valor Total</span>
            <span style={{ fontSize: '0.8rem', color: '#ec4899', fontWeight: 'bold' }}>
              {Number(data.total_value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Status de Pagamento</span>
            <span style={{ 
              fontSize: '0.8rem', 
              fontWeight: 'bold', 
              color: data.status === 'paga' ? '#22c55e' : (data.status === 'atrasada' ? '#ef4444' : '#3b82f6'),
              textTransform: 'capitalize' 
            }}>{data.status || 'aberta'}</span>
          </div>
        </div>
      );
    } else if (entity.type === 'conta_energia') {
      const data = entity.rawData || {};
      title = `Conta Concessionária`;
      icon = <FileText size={18} className="text-cyan-400" />;
      actionBtnText = 'Inspecionar Fatura';
      onActionClick = () => {
        if (onInspectInvoice) onInspectInvoice(data);
      };
      detailsContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {data.mes_referencia && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Mês de Referência</span>
              <span style={{ fontSize: '0.8rem', color: '#ffffff', fontWeight: 'bold' }}>
                {new Date(data.mes_referencia + 'T00:00:00').toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
              </span>
            </div>
          )}
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Valor Concessionária</span>
            <span style={{ fontSize: '0.8rem', color: '#ffffff', fontWeight: 'bold' }}>
              {Number(data.valor_concessionaria || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Valor Cobrado do Assinante</span>
            <span style={{ fontSize: '0.8rem', color: '#06b6d4', fontWeight: 'bold' }}>
              {Number(data.valor_a_pagar || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Energia Compensada</span>
            <span style={{ fontSize: '0.8rem', color: '#22c55e', fontWeight: 'bold' }}>
              {data.consumo_compensado || 0} kWh
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Consumo Medido</span>
            <span style={{ fontSize: '0.8rem', color: '#ffffff' }}>
              {data.consumo_kwh || 0} kWh
            </span>
          </div>
        </div>
      );
    } else if (entity.type === 'supplier') {
      const data = entity.rawData || {};
      title = `Fornecedor: ${data.name || 'Sem Nome'}`;
      icon = <Building size={18} className="text-violet-400" />;
      actionBtnText = 'Gerenciar Fornecedor';
      detailsContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Status</span>
            <span style={{ 
              fontSize: '0.8rem', 
              fontWeight: 'bold', 
              color: data.status === 'ativo' ? '#22c55e' : '#ef4444',
              textTransform: 'capitalize' 
            }}>{data.status || 'Ativo'}</span>
          </div>
          {data.cnpj && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>CNPJ</span>
              <span style={{ fontSize: '0.8rem', color: '#ffffff' }}>{data.cnpj}</span>
            </div>
          )}
        </div>
      );
    } else if (entity.type === 'usina') {
      const data = entity.rawData || {};
      title = `Usina: ${data.name || 'Sem Nome'}`;
      icon = <Zap size={18} className="text-teal-400" />;
      actionBtnText = 'Gerenciar Usina';
      detailsContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Status</span>
            <span style={{ 
              fontSize: '0.8rem', 
              fontWeight: 'bold', 
              color: data.status === 'ativo' ? '#22c55e' : (data.status === 'construcao' ? '#f59e0b' : '#ef4444'),
              textTransform: 'capitalize' 
            }}>{data.status || 'Ativo'}</span>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Capacidade Declarada</span>
            <span style={{ fontSize: '0.8rem', color: '#ffffff', fontWeight: 'bold' }}>{data.capacity_kwp || 0} kWp</span>
          </div>
          {data.concessionaria && (
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Distribuidora Regional</span>
              <span style={{ fontSize: '0.8rem', color: '#eab308', fontWeight: 'bold' }}>{data.concessionaria}</span>
            </div>
          )}
        </div>
      );
    } else if (entity.type === 'concessionaria') {
      const data = entity.rawData || {};
      title = `Distribuidora: ${data.name || 'Distribuidora'}`;
      icon = <Globe size={18} className="text-yellow-400" />;
      actionBtnText = 'Ver Distribuidora';
      detailsContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Região de Cobertura</span>
            <span style={{ fontSize: '0.8rem', color: '#ffffff', fontWeight: 'bold' }}>{data.name}</span>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase' }}>Conexões Ativas no Grafo</span>
            <span style={{ fontSize: '0.8rem', color: '#22c55e', fontWeight: 'bold' }}>
              {links.filter(l => l.source === entity.id || l.target === entity.id).length} unidades
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className="graph-details-drawer">
        <div className="graph-details-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
            {icon}
            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
              {title}
            </span>
          </div>
          <button 
            onClick={() => setInspectedEntity(null)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', borderRadius: '50%' }}
            onMouseOver={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
            onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <X size={16} />
          </button>
        </div>
        <div className="graph-details-content">
          {detailsContent}
        </div>
        <div className="graph-details-footer">
          <button 
            onClick={() => {
              onActionClick();
              showAlert(`Visualizando detalhes avançados de: ${title}`, 'info');
              setInspectedEntity(null);
            }}
            style={{
              flex: 1,
              background: '#FF6600',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '10px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              boxShadow: '0 4px 12px rgba(255, 102, 0, 0.25)',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={e => e.currentTarget.style.backgroundColor = '#ff8c3a'}
            onMouseOut={e => e.currentTarget.style.backgroundColor = '#FF6600'}
          >
            <Eye size={14} /> {actionBtnText}
          </button>
        </div>
      </div>
    );
  };

  const nodesWithInconsistencies = new Set(inconsistencies.flatMap(inc => [inc.invoice_id, inc.uc_id]).filter(Boolean));

  const uniqueMonths = [...new Set(invoices
    .map(i => i.mes_referencia ? i.mes_referencia.substring(0, 7) : null)
    .filter(Boolean)
  )].sort().reverse();

  const formatPeriod = (monthStr) => {
    if (!monthStr) return '';
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    const formatted = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
      {/* Top Filter and Controls Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#090d16',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 102, 0, 0.25)',
        padding: '12px 18px',
        borderRadius: '12px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255, 255, 255, 0.05)',
        gap: '1rem',
        flexWrap: 'wrap',
        zIndex: isFullscreen ? 100000 : 1
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Período de Análise:</span>
          <select
            value={auditPeriodFilter}
            onChange={(e) => setAuditPeriodFilter(e.target.value)}
            style={{
              background: '#0f172a',
              border: '1px solid rgba(255, 102, 0, 0.4)',
              color: '#ffffff',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              outline: 'none',
              cursor: 'pointer',
              boxShadow: '0 0 12px rgba(255, 102, 0, 0.15)'
            }}
          >
            <option value="all" style={{ background: '#0f172a', color: '#ffffff' }}>Qualquer data (Completo)</option>
            {uniqueMonths.map(m => (
              <option key={m} value={m} style={{ background: '#0f172a', color: '#ffffff' }}>{formatPeriod(m)}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: '#ffffff' }}>
          <span style={{ color: '#ffffff', fontWeight: '500' }}>Status de Conexão:</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#22c55e', fontWeight: 'bold' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', boxShadow: '0 0 8px #22c55e' }}></span>
            Monitorando Banco (Supabase)
          </span>
        </div>
      </div>

      {/* Main Canvas + Sidebar Split */}
      <div 
        className="auditor-container"
        style={isFullscreen ? {
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 99999,
          borderRadius: 0,
          border: 'none',
        } : {}}
      >
        {isFullscreen && (
          <button
            onClick={() => setIsFullscreen(false)}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              zIndex: 999999,
              background: 'rgba(239, 68, 68, 0.85)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: 'white',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 16px rgba(239, 68, 68, 0.4)',
              transition: 'all 0.2s ease',
            }}
            title="Fechar Tela Cheia"
            onMouseOver={e => e.currentTarget.style.transform = 'scale(1.1)'}
            onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <X size={20} />
          </button>
        )}

        {/* Auditor Sidebar Panel */}
        <div 
          className="auditor-sidebar"
          style={{
            width: sidebarCollapsed ? '0px' : '380px',
            minWidth: sidebarCollapsed ? '0px' : '380px',
            borderRight: sidebarCollapsed ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
            borderLeft: 'none',
            boxShadow: sidebarCollapsed ? 'none' : '10px 0 30px rgba(0, 0, 0, 0.25)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            height: '100%'
          }}
        >
          <div className="auditor-sidebar-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ background: '#ef4444', width: '8px', height: '8px', borderRadius: '50%', boxShadow: '0 0 8px #ef4444' }}></div>
              <span style={{ fontSize: '0.85rem', fontWeight: '800', letterSpacing: '0.05em', color: '#ffffff' }}>PAINEL DE AUDITORIA</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ background: 'rgba(255,255,255,0.08)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold' }}>
                {inconsistencies.length} CONFLITOS
              </span>
              <button
                onClick={() => setSidebarCollapsed(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginLeft: '0.25rem'
                }}
                title="Recolher Painel"
              >
                <ChevronLeft size={16} />
              </button>
            </div>
          </div>

          <div className="auditor-sidebar-content">
            {/* Agent Bubble */}
            <div className="audit-agent-bubble">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, #FF6600, #ff8c3a)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 10px rgba(255, 102, 0, 0.4)' }}>
                  <Zap size={14} color="white" />
                </div>
                <div>
                  <span style={{ fontWeight: 'bold', color: '#ffffff', fontSize: '0.8rem', display: 'block' }}>Auditor Agêntico B2W</span>
                  <span style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>Analista de Consistência</span>
                </div>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', whiteSpace: 'pre-line' }}>
                {agentMessage}
              </div>
            </div>

            {/* Inconsistency List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h5 style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0.2rem 0' }}>
                Lista de Inconsistências
              </h5>

              {inconsistencies.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.08)' }}>
                  <ShieldCheck size={28} color="#22c55e" style={{ margin: '0 auto 0.5rem auto' }} />
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Nenhuma inconsistência ativa. O sistema está perfeitamente faturado!</p>
                </div>
              ) : (
                inconsistencies.map(inc => {
                  const isActive = activeAlertId === inc.id;
                  return (
                    <div 
                      key={inc.id}
                      className={`audit-error-card ${isActive ? 'active' : ''}`}
                      onClick={() => handleSidebarCardClick(inc)}
                      style={{
                        background: inc.severity === 'critical' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(245, 158, 11, 0.04)',
                        borderColor: inc.severity === 'critical' ? 'rgba(239, 68, 68, 0.18)' : 'rgba(245, 158, 11, 0.15)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.35rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                          {inc.severity === 'critical' ? (
                            <ShieldAlert size={14} color="#ef4444" style={{ flexShrink: 0 }} />
                          ) : (
                            <AlertTriangle size={14} color="#f59e0b" style={{ flexShrink: 0 }} />
                          )}
                          <span style={{ fontWeight: '800', fontSize: '0.75rem', color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {inc.title}
                          </span>
                        </div>
                        <span style={{ 
                          fontSize: '0.55rem', 
                          fontWeight: 'bold', 
                          color: inc.severity === 'critical' ? '#ef4444' : '#f59e0b',
                          background: inc.severity === 'critical' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.12)',
                          padding: '0.1rem 0.35rem', 
                          borderRadius: '4px',
                          textTransform: 'uppercase'
                        }}>
                          {inc.severity}
                        </span>
                      </div>

                      <p style={{ fontSize: '0.7rem', color: '#cbd5e1', margin: '0 0 0.6rem 0', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {inc.description}
                      </p>

                      {isActive && (
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', paddingTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleActionFix(inc.id); }}
                            style={{
                              flex: 1,
                              background: '#FF6600',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '0.4rem',
                              fontSize: '0.65rem',
                              fontWeight: 'bold',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.25rem',
                              boxShadow: '0 2px 5px rgba(255, 102, 0, 0.25)'
                            }}
                          >
                            <Zap size={10} /> Corrigir Erro
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleActionIgnore(inc.id); }}
                            style={{
                              background: 'rgba(255,255,255,0.08)',
                              color: '#94a3b8',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '0.4rem 0.6rem',
                              fontSize: '0.65rem',
                              fontWeight: 'bold',
                              cursor: 'pointer',
                              transition: 'all 0.2s'
                            }}
                            onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                            onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                          >
                            Ignorar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Obsidian Force-Directed Canvas */}
        <div 
          className="graph-canvas-container"
          ref={svgRef}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onMouseDown={handleCanvasMouseDown}
          onClick={handleCanvasClick}
          onWheel={handleWheel}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu(null);
          }}
        >
          {sidebarCollapsed && (
            <button 
              onClick={() => setSidebarCollapsed(false)}
              style={{
                position: 'absolute',
                left: '12px',
                top: '12px',
                zIndex: 50,
                background: 'linear-gradient(135deg, #FF6600, #ff8c3a)',
                border: 'none',
                color: 'white',
                borderRadius: '8px',
                padding: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 12px rgba(255,102,0,0.4)',
                pointerEvents: 'auto',
                transition: 'all 0.2s ease'
              }}
              title="Expandir Painel de Auditoria"
            >
              <ChevronRight size={18} />
            </button>
          )}

          {/* Active Legends Overlay inside Canvas Container */}
          <div style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            zIndex: 40,
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '6px 12px',
            borderRadius: '20px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            pointerEvents: 'auto',
            userSelect: 'none'
          }}>
            {/* Critical Legend Button */}
            <button
              onClick={(e) => { e.stopPropagation(); handleLegendClick('critical'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: activeLegendFilter === 'critical' ? 'rgba(239, 68, 68, 0.45)' : 'rgba(239, 68, 68, 0.1)',
                border: activeLegendFilter === 'critical' ? '2px solid #ef4444' : '1px solid rgba(239, 68, 68, 0.25)',
                color: '#ef4444',
                padding: '4px 10px',
                borderRadius: '15px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeLegendFilter === 'critical' ? '0 0 16px rgba(239, 68, 68, 0.6)' : '0 0 8px rgba(239,68,68,0.1)'
              }}
              onMouseOver={e => {
                if (activeLegendFilter !== 'critical') {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(239,68,68,0.3)';
                }
              }}
              onMouseOut={e => {
                if (activeLegendFilter !== 'critical') {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                  e.currentTarget.style.boxShadow = '0 0 8px rgba(239,68,68,0.1)';
                }
              }}
              title="Clique para destacar e ciclar nós críticos"
            >
              <ShieldAlert size={12} />
              <span>Críticos: {inconsistencies.filter(i => i.severity === 'critical').length}</span>
            </button>

            {/* Warning Legend Button */}
            <button
              onClick={(e) => { e.stopPropagation(); handleLegendClick('warning'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: activeLegendFilter === 'warning' ? 'rgba(245, 158, 11, 0.45)' : 'rgba(245, 158, 11, 0.1)',
                border: activeLegendFilter === 'warning' ? '2px solid #f59e0b' : '1px solid rgba(245, 158, 11, 0.25)',
                color: '#f59e0b',
                padding: '4px 10px',
                borderRadius: '15px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeLegendFilter === 'warning' ? '0 0 16px rgba(245, 158, 11, 0.6)' : '0 0 8px rgba(245,158,11,0.1)'
              }}
              onMouseOver={e => {
                if (activeLegendFilter !== 'warning') {
                  e.currentTarget.style.background = 'rgba(245, 158, 11, 0.2)';
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(245,158,11,0.3)';
                }
              }}
              onMouseOut={e => {
                if (activeLegendFilter !== 'warning') {
                  e.currentTarget.style.background = 'rgba(245, 158, 11, 0.1)';
                  e.currentTarget.style.boxShadow = '0 0 8px rgba(245,158,11,0.1)';
                }
              }}
              title="Clique para destacar e ciclar avisos"
            >
              <AlertTriangle size={12} />
              <span>Avisos: {inconsistencies.filter(i => i.severity === 'warning').length}</span>
            </button>

            {/* UC Legend Button */}
            <button
              onClick={(e) => { e.stopPropagation(); handleLegendClick('uc'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: activeLegendFilter === 'uc' ? 'rgba(34, 197, 94, 0.45)' : 'rgba(34, 197, 94, 0.1)',
                border: activeLegendFilter === 'uc' ? '2px solid #22c55e' : '1px solid rgba(34, 197, 94, 0.25)',
                color: '#22c55e',
                padding: '4px 10px',
                borderRadius: '15px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeLegendFilter === 'uc' ? '0 0 16px rgba(34, 197, 94, 0.6)' : '0 0 8px rgba(34,197,94,0.1)'
              }}
              onMouseOver={e => {
                if (activeLegendFilter !== 'uc') {
                  e.currentTarget.style.background = 'rgba(34, 197, 94, 0.2)';
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(34,197,94,0.3)';
                }
              }}
              onMouseOut={e => {
                if (activeLegendFilter !== 'uc') {
                  e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)';
                  e.currentTarget.style.boxShadow = '0 0 8px rgba(34,197,94,0.1)';
                }
              }}
              title="Clique para destacar e ciclar Unidades Consumidoras"
            >
              <CheckCircle2 size={12} />
              <span>UCs: {ucs.length}</span>
            </button>

            {/* Invoiced Info Button */}
            <button
              onClick={(e) => { e.stopPropagation(); handleLegendClick('healthy'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: activeLegendFilter === 'healthy' ? 'rgba(59, 130, 246, 0.45)' : 'rgba(148, 163, 184, 0.1)',
                border: activeLegendFilter === 'healthy' ? '2px solid #3b82f6' : '1px solid rgba(148, 163, 184, 0.25)',
                color: activeLegendFilter === 'healthy' ? '#60a5fa' : '#cbd5e1',
                padding: '4px 10px',
                borderRadius: '15px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeLegendFilter === 'healthy' ? '0 0 16px rgba(59, 130, 246, 0.6)' : '0 0 8px rgba(148,163,184,0.1)'
              }}
              onMouseOver={e => {
                if (activeLegendFilter !== 'healthy') {
                  e.currentTarget.style.background = 'rgba(148, 163, 184, 0.2)';
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(148,163,184,0.3)';
                }
              }}
              onMouseOut={e => {
                if (activeLegendFilter !== 'healthy') {
                  e.currentTarget.style.background = 'rgba(148, 163, 184, 0.1)';
                  e.currentTarget.style.boxShadow = '0 0 8px rgba(148,163,184,0.1)';
                }
              }}
              title="Clique para destacar e focar faturas saudáveis"
            >
              <FileText size={12} />
              <span>Faturas: {invoices.length}</span>
            </button>
          </div>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem', color: '#94a3b8' }}>
              <RefreshCw className="animate-spin" size={32} />
              <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Realizando auditoria de faturas...</span>
            </div>
          ) : (
            <svg 
              width="100%" 
              height="100%" 
              viewBox={`0 0 ${width} ${height}`} 
              style={{ pointerEvents: 'none', background: 'transparent' }}
            >
              {/* Premium Glow Filters */}
              <defs>
                <filter id="glow-error" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feColorMatrix type="matrix" values="
                    1 0 0 0 1   
                    0 0 0 0 0   
                    0 0 0 0 0   
                    0 0 0 0.8 0
                  "/>
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="glow-warn" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feColorMatrix type="matrix" values="
                    0.9 0 0 0 0.9   
                    0 0.6 0 0 0.6   
                    0 0 0 0 0   
                    0 0 0 0.7 0
                  "/>
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                {/* Silver Metallic Gradient */}
                <linearGradient id="silver-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="25%" stopColor="#f1f5f9" />
                  <stop offset="50%" stopColor="#94a3b8" />
                  <stop offset="75%" stopColor="#cbd5e1" />
                  <stop offset="100%" stopColor="#334155" />
                </linearGradient>

                {/* Silver Neon Glow Filter */}
                <filter id="glow-silver" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="7" result="blur" />
                  <feColorMatrix type="matrix" values="
                    0.9 0 0 0 0.9   
                    0 0.9 0 0 0.9   
                    0 0  0.9 0 0.9   
                    0 0 0 0.9 0
                  "/>
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                {/* Neon Green Glow Filter */}
                <filter id="glow-success" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feColorMatrix type="matrix" values="
                    0 0 0 0 0   
                    0 1 0 0 0.8   
                    0 0 0 0 0   
                    0 0 0 0.85 0
                  "/>
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                {/* Neon Blue Glow Filter */}
                <filter id="glow-primary" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feColorMatrix type="matrix" values="
                    0 0 0 0 0   
                    0 0 0 0 0   
                    0 0 1 0 0.8   
                    0 0 0 0.85 0
                  "/>
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <g transform={`translate(${panX}, ${panY}) scale(${zoom})`} style={{ pointerEvents: 'auto' }}>
                
                {/* 1. Links / Connections */}
                {links.map((link, idx) => {
                  const sourceNode = nodes.find(n => n.id === link.source);
                  const targetNode = nodes.find(n => n.id === link.target);
                  
                  const sourceMatches = sourceNode && (!activeLegendFilter || (
                    (activeLegendFilter === 'critical' && sourceNode.type === 'inconsistency' && sourceNode.severity === 'critical') ||
                    (activeLegendFilter === 'warning' && sourceNode.type === 'inconsistency' && sourceNode.severity === 'warning') ||
                    (activeLegendFilter === 'uc' && sourceNode.type === 'uc') ||
                    (activeLegendFilter === 'healthy' && (sourceNode.type === 'fatura' || sourceNode.type === 'conta_energia') && !nodesWithInconsistencies.has(sourceNode.id))
                  ));
                  
                  const targetMatches = targetNode && (!activeLegendFilter || (
                    (activeLegendFilter === 'critical' && targetNode.type === 'inconsistency' && targetNode.severity === 'critical') ||
                    (activeLegendFilter === 'warning' && targetNode.type === 'inconsistency' && targetNode.severity === 'warning') ||
                    (activeLegendFilter === 'uc' && targetNode.type === 'uc') ||
                    (activeLegendFilter === 'healthy' && (targetNode.type === 'fatura' || targetNode.type === 'conta_energia') && !nodesWithInconsistencies.has(targetNode.id))
                  ));
                  
                  const isHighlighted = hoveredNode && (hoveredNode.id === link.source || hoveredNode.id === link.target);
                  const isLinkSelected = selectedNode && (selectedNode.id === link.source || selectedNode.id === link.target);
                  const isLinkDimmedByLegend = activeLegendFilter && (!sourceMatches || !targetMatches);
                  
                  const isDimmedLink = isLinkDimmedByLegend || (
                    selectedNode 
                      ? (!isLinkSelected && (!hoveredNode || !isHighlighted))
                      : (hoveredNode && !isHighlighted)
                  );
                  
                  let linkStroke = isLinkSelected ? '#ffffff' : (isHighlighted ? '#a855f7' : link.color);
                  if (isDimmedLink) {
                    linkStroke = '#1c2330';
                  }
                  
                  return (
                    <line
                      key={`link-${idx}`}
                      id={`link-${idx}`}
                      className="graph-link"
                      x1={sourceNode?.x ?? 0}
                      y1={sourceNode?.y ?? 0}
                      x2={targetNode?.x ?? 0}
                      y2={targetNode?.y ?? 0}
                      stroke={linkStroke}
                      strokeWidth={isLinkSelected ? link.width + 3.5 : (isHighlighted ? link.width + 1.5 : link.width)}
                      opacity={isLinkSelected ? 0.95 : (isDimmedLink ? 0.08 : 0.28)}
                      filter={isLinkSelected ? 'url(#glow-silver)' : undefined}
                    />
                  );
                })}

                {/* 2. Glow ring around pulsing inconsistency nodes & active status nodes */}
                {nodes.map(node => {
                  const isSelected = selectedNode && selectedNode.id === node.id;
                  const isHovered = hoveredNode && hoveredNode.id === node.id;
                  const isConnectedToSelected = selectedNode && links.some(l => 
                    (l.source === selectedNode.id && l.target === node.id) ||
                    (l.target === selectedNode.id && l.source === node.id)
                  );
                  
                  const matchesLegendFilter = !activeLegendFilter || (
                    (activeLegendFilter === 'critical' && node.type === 'inconsistency' && node.severity === 'critical') ||
                    (activeLegendFilter === 'warning' && node.type === 'inconsistency' && node.severity === 'warning') ||
                    (activeLegendFilter === 'uc' && node.type === 'uc') ||
                    (activeLegendFilter === 'healthy' && (node.type === 'fatura' || node.type === 'conta_energia') && !nodesWithInconsistencies.has(node.id))
                  );
                  const isDimmedByLegend = activeLegendFilter && !matchesLegendFilter;
                  const isNodeConnectedToHovered = hoveredNode && links.some(l => 
                    (l.source === hoveredNode.id && l.target === node.id) ||
                    (l.target === hoveredNode.id && l.source === node.id)
                  );
                  
                  const isDimmed = isDimmedByLegend || (
                    selectedNode 
                      ? (!isSelected && !isConnectedToSelected && !isHovered && !isNodeConnectedToHovered)
                      : (hoveredNode && !isHovered && !isNodeConnectedToHovered)
                  );
                  
                  if (isDimmed) return null;

                  const showRing = node.pulse || isSelected || isHovered || (activeLegendFilter && matchesLegendFilter);
                  if (!showRing) return null;

                  let ringStroke = '#ffffff';
                  let ringFilter = 'url(#glow-silver)';
                  
                  if (node.type === 'inconsistency') {
                    if (node.severity === 'critical') {
                      ringStroke = '#ef4444';
                      ringFilter = 'url(#glow-error)';
                    } else if (node.severity === 'warning') {
                      ringStroke = '#f59e0b';
                      ringFilter = 'url(#glow-warn)';
                    }
                  } else if (node.type === 'uc') {
                    ringStroke = '#22c55e';
                    ringFilter = 'url(#glow-success)';
                  } else if (node.type === 'subscriber') {
                    ringStroke = '#3b82f6';
                    ringFilter = 'url(#glow-primary)';
                  } else if (node.type === 'fatura') {
                    ringStroke = '#ec4899';
                    ringFilter = 'url(#glow-primary)';
                  } else if (node.type === 'conta_energia') {
                    ringStroke = '#06b6d4';
                    ringFilter = 'url(#glow-primary)';
                  } else if (node.type === 'lead') {
                    ringStroke = '#a855f7';
                    ringFilter = 'url(#glow-primary)';
                  } else if (node.type === 'originator') {
                    ringStroke = '#f97316';
                    ringFilter = 'url(#glow-primary)';
                  } else if (node.type === 'supplier') {
                    ringStroke = '#8b5cf6';
                    ringFilter = 'url(#glow-primary)';
                  } else if (node.type === 'usina') {
                    ringStroke = '#14b8a6';
                    ringFilter = 'url(#glow-primary)';
                  } else if (node.type === 'concessionaria') {
                    ringStroke = '#eab308';
                    ringFilter = 'url(#glow-warn)';
                  }
                  
                  return (
                    <circle
                      key={`ring-${node.id}`}
                      id={`ring-${node.id}`}
                      className="graph-node-pulse"
                      cx={node.x ?? 0}
                      cy={node.y ?? 0}
                      r={isSelected ? node.size + 12.5 : isHovered ? node.size + 9.5 : node.size + 8}
                      fill="none"
                      stroke={ringStroke}
                      strokeWidth={isSelected ? 3.5 : isConnectedToSelected ? 2.5 : 2}
                      filter={ringFilter}
                      opacity={isSelected ? 0.95 : isConnectedToSelected ? 0.6 : 0.4}
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                })}

                {/* 3. Node Circles */}
                {nodes.map(node => {
                  const isSelected = selectedNode && selectedNode.id === node.id;
                  const isHovered = hoveredNode && hoveredNode.id === node.id;
                  const isConnectedToSelected = selectedNode && links.some(l => 
                    (l.source === selectedNode.id && l.target === node.id) ||
                    (l.target === selectedNode.id && l.source === node.id)
                  );
                  
                  const matchesLegendFilter = !activeLegendFilter || (
                    (activeLegendFilter === 'critical' && node.type === 'inconsistency' && node.severity === 'critical') ||
                    (activeLegendFilter === 'warning' && node.type === 'inconsistency' && node.severity === 'warning') ||
                    (activeLegendFilter === 'uc' && node.type === 'uc') ||
                    (activeLegendFilter === 'healthy' && (node.type === 'fatura' || node.type === 'conta_energia') && !nodesWithInconsistencies.has(node.id))
                  );
                  const isDimmedByLegend = activeLegendFilter && !matchesLegendFilter;
                  const isNodeConnectedToHovered = hoveredNode && links.some(l => 
                    (l.source === hoveredNode.id && l.target === node.id) ||
                    (l.target === hoveredNode.id && l.source === node.id)
                  );
                  
                  const isDimmed = isDimmedByLegend || (
                    selectedNode 
                      ? (!isSelected && !isConnectedToSelected && !isHovered && !isNodeConnectedToHovered)
                      : (hoveredNode && !isHovered && !isNodeConnectedToHovered)
                  );

                  let nodeFill = 'url(#silver-gradient)';
                  let nodeStroke = node.stroke || 'rgba(255, 255, 255, 0.2)';
                  let nodeFilter = 'url(#glow-silver)';

                  if (activeLegendFilter) {
                    if (matchesLegendFilter) {
                      if (activeLegendFilter === 'critical') {
                        nodeFill = '#ef4444';
                        nodeStroke = '#ffffff';
                        nodeFilter = 'url(#glow-error)';
                      } else if (activeLegendFilter === 'warning') {
                        nodeFill = '#f59e0b';
                        nodeStroke = '#ffffff';
                        nodeFilter = 'url(#glow-warn)';
                      } else if (activeLegendFilter === 'uc') {
                        nodeFill = '#22c55e';
                        nodeStroke = '#ffffff';
                        nodeFilter = 'url(#glow-success)';
                      } else if (activeLegendFilter === 'healthy') {
                        nodeFill = '#3b82f6';
                        nodeStroke = '#ffffff';
                        nodeFilter = 'url(#glow-primary)';
                      }
                    } else {
                      nodeFill = '#111622';
                      nodeStroke = 'rgba(255, 255, 255, 0.03)';
                      nodeFilter = 'none';
                    }
                  } else if (selectedNode) {
                    if (isSelected) {
                      if (node.type === 'inconsistency') {
                        if (node.severity === 'critical') {
                          nodeFill = '#ef4444';
                          nodeFilter = 'url(#glow-error)';
                        } else {
                          nodeFill = '#f59e0b';
                          nodeFilter = 'url(#glow-warn)';
                        }
                      } else if (node.type === 'uc') {
                        nodeFill = '#22c55e';
                        nodeFilter = 'url(#glow-success)';
                      } else if (node.type === 'fatura') {
                        nodeFill = '#ec4899';
                        nodeFilter = 'url(#glow-primary)';
                      } else if (node.type === 'conta_energia') {
                        nodeFill = '#06b6d4';
                        nodeFilter = 'url(#glow-primary)';
                      } else if (node.type === 'lead') {
                        nodeFill = '#a855f7';
                        nodeFilter = 'url(#glow-primary)';
                      } else if (node.type === 'originator') {
                        nodeFill = '#f97316';
                        nodeFilter = 'url(#glow-primary)';
                      } else if (node.type === 'subscriber') {
                        nodeFill = '#3b82f6';
                        nodeFilter = 'url(#glow-primary)';
                      } else if (node.type === 'supplier') {
                        nodeFill = '#8b5cf6';
                        nodeFilter = 'url(#glow-primary)';
                      } else if (node.type === 'usina') {
                        nodeFill = '#14b8a6';
                        nodeFilter = 'url(#glow-primary)';
                      } else if (node.type === 'concessionaria') {
                        nodeFill = '#eab308';
                        nodeFilter = 'url(#glow-warn)';
                      }
                      nodeStroke = '#ffffff';
                    } else if (isConnectedToSelected) {
                      nodeStroke = '#ffffff';
                      nodeFilter = 'url(#glow-silver)';
                    } else {
                      nodeFill = '#111622';
                      nodeStroke = 'rgba(255, 255, 255, 0.03)';
                      nodeFilter = 'none';
                    }
                  } else if (isHovered) {
                    nodeStroke = '#ffffff';
                  }

                  return (
                    <circle
                      key={node.id}
                      id={`circle-${node.id}`}
                      className="graph-node"
                      cx={node.x ?? 0}
                      cy={node.y ?? 0}
                      r={isSelected ? node.size + 4.5 : (isHovered ? node.size + 2 : node.size)}
                      fill={nodeFill}
                      stroke={nodeStroke}
                      strokeWidth={isSelected ? 3.5 : (isConnectedToSelected || isHovered ? 2 : 1.5)}
                      filter={nodeFilter}
                      opacity={isDimmed ? 0.18 : 1}
                      style={{ transition: 'r 0.15s, opacity 0.2s', cursor: 'grab' }}
                      onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                      onClick={(e) => { e.stopPropagation(); handleNodeClick(node, true); }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleNodeContextMenu(e, node);
                      }}
                      onMouseEnter={() => setHoveredNode(node)}
                      onMouseLeave={() => setHoveredNode(null)}
                    />
                  );
                })}

                {/* 4. Labels */}
                {nodes.map(node => {
                  const isSelected = selectedNode && selectedNode.id === node.id;
                  const isHovered = hoveredNode && hoveredNode.id === node.id;
                  const isConnectedToSelected = selectedNode && links.some(l => 
                    (l.source === selectedNode.id && l.target === node.id) ||
                    (l.target === selectedNode.id && l.source === node.id)
                  );
                  
                  const matchesLegendFilter = !activeLegendFilter || (
                    (activeLegendFilter === 'critical' && node.type === 'inconsistency' && node.severity === 'critical') ||
                    (activeLegendFilter === 'warning' && node.type === 'inconsistency' && node.severity === 'warning') ||
                    (activeLegendFilter === 'uc' && node.type === 'uc') ||
                    (activeLegendFilter === 'healthy' && (node.type === 'fatura' || node.type === 'conta_energia') && !nodesWithInconsistencies.has(node.id))
                  );
                  const isDimmedByLegend = activeLegendFilter && !matchesLegendFilter;
                  const isNodeConnectedToHovered = hoveredNode && links.some(l => 
                    (l.source === hoveredNode.id && l.target === node.id) ||
                    (l.target === hoveredNode.id && l.source === node.id)
                  );
                  
                  const isDimmed = isDimmedByLegend || (
                    selectedNode 
                      ? (!isSelected && !isConnectedToSelected && !isHovered && !isNodeConnectedToHovered)
                      : (hoveredNode && !isHovered && !isNodeConnectedToHovered)
                  );

                  return (
                    <text
                      key={`label-${node.id}`}
                      id={`label-${node.id}`}
                      x={node.x ?? 0}
                      y={(node.y ?? 0) + node.size + 14}
                      textAnchor="middle"
                      fill={isSelected ? '#ffffff' : (isConnectedToSelected ? '#e2e8f0' : '#94a3b8')}
                      fontSize={isSelected ? '10px' : '9px'}
                      fontWeight={isSelected ? 'bold' : 'normal'}
                      opacity={isDimmed ? 0.08 : 0.85}
                      style={{ pointerEvents: 'none', transition: 'opacity 0.2s', userSelect: 'none' }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleNodeContextMenu(e, node);
                      }}
                    >
                      {node.label}
                    </text>
                  );
                })}

              </g>
            </svg>
          )}

          {renderContextMenu()}
          {renderInspectedEntityDetails()}

          {/* Settings Panel Toggle Button */}
          <button 
            className="graph-control-btn"
            style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', zIndex: 12, background: 'rgba(15, 23, 42, 0.8)' }}
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings size={18} />
          </button>

          {/* Graph Force Settings Overlay (Obsidian config dashboard) */}
          {showSettings && (
            <div className="graph-settings-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.4rem' }}>
                <h5 style={{ fontSize: '0.85rem', color: '#ffffff', margin: 0, fontWeight: 'bold' }}>Ajustes de Forças (Grafo)</h5>
                <button onClick={() => setShowSettings(false)} style={{ background: 'none', color: '#94a3b8', border: 'none', cursor: 'pointer' }}><X size={14} /></button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.75rem' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span>Repulsão Coulomb (Coulomb Force)</span>
                    <span style={{ fontWeight: 'bold' }}>{repulsion}</span>
                  </div>
                  <input type="range" min="100" max="600" step="20" value={repulsion} onChange={e => setRepulsion(Number(e.target.value))} style={{ width: '100%' }} />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span>Comprimento de Link (Hooke Distance)</span>
                    <span style={{ fontWeight: 'bold' }}>{linkDistance}px</span>
                  </div>
                  <input type="range" min="50" max="180" step="5" value={linkDistance} onChange={e => setLinkDistance(Number(e.target.value))} style={{ width: '100%' }} />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span>Gravidade de Centro (Gravity)</span>
                    <span style={{ fontWeight: 'bold' }}>{gravity.toFixed(3)}</span>
                  </div>
                  <input type="range" min="0.01" max="0.1" step="0.005" value={gravity} onChange={e => setGravity(Number(e.target.value))} style={{ width: '100%' }} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.5rem' }}>
                  <input type="checkbox" id="healthy-toggle" checked={healthyVisible} onChange={e => { setHealthyVisible(e.target.checked); buildGraphData(ucs, invoices, inconsistencies); }} style={{ cursor: 'pointer' }} />
                  <label htmlFor="healthy-toggle" style={{ cursor: 'pointer', userSelect: 'none' }}>Exibir UCs e Faturas Saudáveis</label>
                </div>
              </div>
            </div>
          )}

          {/* Quick HUD controls overlay (Obsidian typical layout) */}
          <div className="graph-control-overlay">
            <button className="graph-control-btn" title="Aumentar Zoom" onClick={() => setZoom(prev => Math.min(2.5, prev + 0.15))}>
              <ZoomIn size={16} />
            </button>
            <button className="graph-control-btn" title="Diminuir Zoom" onClick={() => setZoom(prev => Math.max(0.3, prev - 0.15))}>
              <ZoomOut size={16} />
            </button>
            <button className="graph-control-btn" title="Expandir Tela Cheia (Fullscreen)" onClick={() => setIsFullscreen(!isFullscreen)}>
              <Maximize size={16} />
            </button>
            <div style={{ width: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 2px' }}></div>
            <button 
              className="graph-control-btn" 
              title={physicsEnabled ? "Pausar Física" : "Iniciar Física"}
              onClick={() => setPhysicsEnabled(!physicsEnabled)}
            >
              {physicsEnabled ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button className="graph-control-btn" title="Reanalisar Faturas" onClick={triggerReAudit}>
              <RefreshCw size={16} />
            </button>
          </div>

          {/* Floating AI Chat Assistant & Training Widget */}
          <button 
            className="graph-chat-toggle"
            title="Chat de Insights e Treinamento"
            onClick={() => setChatOpen(!chatOpen)}
            style={{ 
              background: chatOpen ? 'rgba(15, 23, 42, 0.9)' : 'linear-gradient(135deg, #FF6600, #ff8c3a)',
              border: chatOpen ? '1px solid rgba(255,255,255,0.1)' : 'none'
            }}
          >
            {chatOpen ? <X size={20} /> : <MessageSquare size={20} />}
          </button>

          <div className={`graph-chat-floating ${chatOpen ? '' : 'collapsed'}`}>
            {/* Header */}
            <div className="graph-chat-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'linear-gradient(135deg, #FF6600, #ff8c3a)', display: 'flex', alignItems: 'center', justifyItems: 'center', color: 'white', justifyContent: 'center' }}>
                  <Zap size={12} />
                </div>
                <div>
                  <h6 style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'white', margin: 0 }}>Insights e Treinamento</h6>
                  <span style={{ fontSize: '0.55rem', color: '#ff8c3a', fontWeight: 'bold', display: 'block', textTransform: 'uppercase' }}>Sistema Adaptativo</span>
                </div>
              </div>
              <button 
                onClick={() => setChatOpen(false)} 
                style={{ background: 'none', color: '#94a3b8', border: 'none', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Messages */}
            <div className="graph-chat-messages">
              {chatMessages.map(msg => (
                <div 
                  key={msg.id} 
                  className={`chat-bubble ${msg.sender}`}
                  style={{
                    alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start'
                  }}
                >
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{msg.text}</p>
                  <span style={{ display: 'block', fontSize: '0.5rem', opacity: 0.5, textAlign: 'right', marginTop: '0.2rem' }}>
                    {msg.timestamp}
                  </span>
                </div>
              ))}
              <div ref={chatMessagesEndRef} />
            </div>

            {/* Active Trained Rules List inside Chat */}
            {customRules.length > 0 && (
              <div style={{ padding: '0.4rem 1rem', background: 'rgba(255,102,0,0.05)', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 'bold', marginRight: '0.2rem' }}>Regras Ativas:</span>
                {customRules.map(rule => (
                  <span key={rule.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: 'rgba(255, 102, 0, 0.15)', border: '1px solid rgba(255, 102, 0, 0.3)', color: '#ff8c3a', borderRadius: '4px', padding: '0.1rem 0.3rem', fontSize: '0.55rem', fontWeight: 'bold' }}>
                    {rule.type === 'min_value' ? `Valor < R$ ${rule.value}` : `Desvio < ${rule.value}%`}
                    <X 
                      size={8} 
                      style={{ cursor: 'pointer' }} 
                      onClick={() => {
                        setCustomRules(prev => prev.filter(r => r.id !== rule.id));
                        showAlert('Regra removida. Restaurando análise original...', 'info');
                      }} 
                    />
                  </span>
                ))}
              </div>
            )}

            {/* Quick Suggestions */}
            <div className="chat-chips-container">
              <button className="chat-chip" onClick={() => handleSendMessage('💡 Insights das UCs')}>
                💡 Insights
              </button>
              <button className="chat-chip" onClick={() => handleSendMessage('🔍 Explicar erros do grafo')}>
                🔍 Explicar Erros
              </button>
              <button className="chat-chip" onClick={() => handleSendMessage('Ignorar faturas abaixo de R$ 15')}>
                🧠 Ignorar &lt; R$ 15
              </button>
              <button className="chat-chip" onClick={() => handleSendMessage('Ignorar desvios menores que 15%')}>
                🧠 Tolerar desvios &lt; 15%
              </button>
            </div>

            {/* Input Area */}
            <div className="graph-chat-input-area">
              <input 
                type="text" 
                className="graph-chat-input"
                placeholder="Peça insights ou ensine uma nova regra..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSendMessage();
                }}
              />
              <button 
                className="graph-chat-send"
                onClick={() => handleSendMessage()}
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Inconsistency Inspection Popup Modal */}
      {activeInconsistency && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(9, 13, 22, 0.8)',
          backdropFilter: 'blur(8px)',
          zIndex: 100000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'fadeIn 0.25s ease'
        }} onClick={() => setActiveInconsistency(null)}>
          <div style={{
            background: 'rgba(15, 23, 42, 0.95)',
            border: activeInconsistency.severity === 'critical' ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '16px',
            width: '90%',
            maxWidth: '520px',
            boxShadow: activeInconsistency.severity === 'critical' ? '0 24px 60px rgba(239, 68, 68, 0.15)' : '0 24px 60px rgba(245, 158, 11, 0.15)',
            overflow: 'hidden',
            animation: 'scaleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)'
          }} onClick={(e) => e.stopPropagation()}>
            
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              background: activeInconsistency.severity === 'critical' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.06)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                {activeInconsistency.severity === 'critical' ? (
                  <ShieldAlert size={20} color="#ef4444" style={{ flexShrink: 0 }} />
                ) : (
                  <AlertTriangle size={20} color="#f59e0b" style={{ flexShrink: 0 }} />
                )}
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '800', color: '#ffffff' }}>
                    {activeInconsistency.title}
                  </h4>
                  <span style={{
                    fontSize: '0.6rem',
                    fontWeight: 'bold',
                    color: activeInconsistency.severity === 'critical' ? '#ef4444' : '#f59e0b',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Conflito Grau {activeInconsistency.severity === 'critical' ? 'Crítico' : 'Aviso'}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setActiveInconsistency(null)}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: 'none',
                  color: '#94a3b8',
                  borderRadius: '50%',
                  width: '28px',
                  height: '28px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s'
                }}
                onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div>
                <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Divergência Encontrada</span>
                <p style={{ fontSize: '0.8rem', color: '#e2e8f0', margin: 0, lineHeight: 1.45 }}>
                  {activeInconsistency.description}
                </p>
              </div>

              {/* Recommendation Box */}
              <div style={{
                background: 'rgba(255, 102, 0, 0.05)',
                border: '1px dashed rgba(255, 102, 0, 0.2)',
                borderRadius: '8px',
                padding: '12px',
                display: 'flex',
                gap: '0.6rem'
              }}>
                <Zap size={16} color="#FF6600" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <span style={{ fontSize: '0.68rem', fontWeight: 'bold', color: '#ff8c3a', display: 'block', textTransform: 'uppercase' }}>Recomendação Agêntica</span>
                  <p style={{ fontSize: '0.75rem', color: '#cbd5e1', margin: '2px 0 0 0', lineHeight: 1.4 }}>
                    {activeInconsistency.type === 'duplicate_bill' && 'Excluir a fatura excedente ou colocá-la como "Sem Faturamento".'}
                    {activeInconsistency.type === 'duplicate_ref' && 'Ajustar as datas de leitura ou os meses de referência redundantes.'}
                    {activeInconsistency.type === 'overlap' && 'Disparar um re-scrapear automático do portal da concessionária.'}
                    {activeInconsistency.type === 'billing_error' && 'Revisar a fórmula tarifária do assinante ou atualizar o desconto contratual.'}
                    {activeInconsistency.type === 'no_compensation' && 'Verificar pendências junto à concessionária ou revisar as credenciais do portal.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div style={{
              display: 'flex',
              gap: '0.75rem',
              padding: '16px 20px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              background: '#0b0f19'
            }}>
              <button
                onClick={() => {
                  handleActionIgnore(activeInconsistency.id);
                  setActiveInconsistency(null);
                }}
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.06)',
                  color: '#94a3b8',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '0.75rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              >
                Ignorar Alerta
              </button>

              {activeInconsistency.invoice_id && (
                <button
                  onClick={() => {
                    onInspectInvoice(activeInconsistency.invoice_id);
                    setActiveInconsistency(null);
                  }}
                  style={{
                    flex: 1.2,
                    background: 'rgba(59, 130, 246, 0.1)',
                    color: '#60a5fa',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)'}
                  onMouseOut={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'}
                >
                  Visualizar Fatura
                </button>
              )}

              <button
                onClick={() => {
                  handleActionFix(activeInconsistency.id);
                  setActiveInconsistency(null);
                }}
                style={{
                  flex: 1.5,
                  background: 'linear-gradient(135deg, #FF6600, #ff8c3a)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '0.75rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                  boxShadow: '0 4px 12px rgba(255, 102, 0, 0.25)',
                  transition: 'all 0.2s'
                }}
                onMouseOver={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                onMouseOut={e => e.currentTarget.style.filter = 'brightness(1)'}
              >
                <Zap size={12} /> Corrigir Agora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
