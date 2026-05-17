import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { 
  AlertTriangle, CheckCircle2, Zap, Settings, ZoomIn, ZoomOut, 
  Maximize, Play, Pause, RefreshCw, UserCheck, ShieldAlert, 
  FileText, X, Eye, EyeOff, ShieldCheck, ChevronRight, HelpCircle,
  MessageSquare, Send
} from 'lucide-react';
import { useUI } from '../../contexts/UIContext';

export default function AuditGraphView() {
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

  // Re-run audit scanning when custom rules change
  useEffect(() => {
    if (invoices.length > 0) {
      runAudit(invoices, ucs);
    }
  }, [customRules]);

  const fetchAuditData = async () => {
    setLoading(true);
    setAgentStatus('scanning');
    setAgentMessage('Carregando informações das faturas e unidades consumidoras...');
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

      setInvoices(invoicesData || []);
      setUcs(ucsData || []);

      // 3. Process audits
      runAudit(invoicesData || [], ucsData || []);

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
    const uniqueUcs = new Set();
    const uniqueInvoices = new Set();

    // 1. Add Inconsistencies as central critical nodes
    allInconsistencies.forEach(inc => {
      newNodes.push({
        id: inc.id,
        type: 'inconsistency',
        errorType: inc.type,
        severity: inc.severity,
        label: inc.title,
        size: 14,
        color: inc.severity === 'critical' ? '#ef4444' : '#f59e0b',
        pulse: true,
        x: width / 2 + (Math.random() - 0.5) * 150,
        y: height / 2 + (Math.random() - 0.5) * 150,
        vx: 0,
        vy: 0
      });

      // Link Inconsistency to its Invoice
      if (inc.invoice_id) {
        newLinks.push({
          source: inc.id,
          target: `inv_${inc.invoice_id}`,
          color: inc.severity === 'critical' ? '#f87171' : '#fbbf24',
          width: 2
        });
      }

      // Link Inconsistency directly to UC if no invoice is connected, or link UC to Invoice
      if (inc.uc_id) {
        uniqueUcs.add(inc.uc_id);
      }
    });

    // 2. Add Invoices associated with inconsistencies (or all if selected)
    allInvoices.forEach(inv => {
      const hasError = allInconsistencies.some(inc => inc.invoice_id === inv.id);
      
      // If we only show healthy ones depending on toggle
      if (hasError || healthyVisible) {
        const invId = `inv_${inv.id}`;
        uniqueInvoices.add(invId);
        
        const mesRefFormatted = inv.mes_referencia 
          ? new Date(inv.mes_referencia + 'T00:00:00').toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' })
          : 'S/Ref';

        newNodes.push({
          id: invId,
          type: 'invoice',
          label: `Fat ${mesRefFormatted}`,
          size: 10,
          color: hasError ? '#a855f7' : '#3b82f6',
          x: width / 2 + (Math.random() - 0.5) * 200,
          y: height / 2 + (Math.random() - 0.5) * 200,
          vx: 0,
          vy: 0,
          invoiceData: inv
        });

        // Link Invoice to UC
        newLinks.push({
          source: invId,
          target: `uc_${inv.uc_id}`,
          color: 'rgba(255, 255, 255, 0.12)',
          width: 1
        });
        
        uniqueUcs.add(inv.uc_id);
      }
    });

    // 3. Add UCs
    allUcs.forEach(uc => {
      if (uniqueUcs.has(uc.id) || healthyVisible) {
        const hasCriticalError = allInconsistencies.some(inc => inc.uc_id === uc.id && inc.severity === 'critical');
        const hasWarning = allInconsistencies.some(inc => inc.uc_id === uc.id && inc.severity === 'warning');

        let color = '#22c55e'; // Green - healthy
        if (hasCriticalError) color = '#ef4444'; // Red
        else if (hasWarning) color = '#f59e0b'; // Orange

        newNodes.push({
          id: `uc_${uc.id}`,
          type: 'uc',
          label: `UC ${uc.numero_uc}`,
          size: 12,
          color,
          x: width / 2 + (Math.random() - 0.5) * 350,
          y: height / 2 + (Math.random() - 0.5) * 350,
          vx: 0,
          vy: 0,
          ucData: uc
        });
      }
    });

    nodesStateRef.current = newNodes;
    setNodes(newNodes);
    setLinks(newLinks);
  };

  // Re-run Audits manually
  const triggerReAudit = () => {
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
  const handleNodeClick = (node) => {
    setSelectedNode(node);
    
    if (node.type === 'inconsistency') {
      const inc = inconsistencies.find(i => i.id === node.id);
      if (inc) {
        handleInconsistencyClick(inc);
      }
    } else if (node.type === 'uc') {
      setAgentStatus('ready');
      setAgentMessage(`Você selecionou a **Unidade Consumidora ${node.ucData.numero_uc}** (${node.ucData.titular_conta}). Ela está atualmente no status **'${node.ucData.status}'**.
      
      **Concessionária:** ${node.ucData.concessionaria || 'Neoenergia Cosern'}
      **Erros Pendentes:** ${inconsistencies.filter(i => i.uc_id === node.ucData.id).length} erro(s).`);
    } else if (node.type === 'invoice') {
      const inv = node.invoiceData;
      const formattedValue = Number(inv.valor_concessionaria || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      setAgentStatus('ready');
      setAgentMessage(`Você selecionou a **Fatura de Ref. ${inv.mes_referencia ? inv.mes_referencia.substring(0, 7) : '-'}** da UC ${inv.consumer_units?.numero_uc}.
      
      **Valor Concessionária:** ${formattedValue}
      **Valor Cobrado do Assinante:** R$ ${Number(inv.valor_a_pagar || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
      **Status no CRM:** ${inv.status || 'pendente'}`);
    }

    // Smooth camera focus (pan to node center)
    const targetX = width / 2 - node.x;
    const targetY = height / 2 - node.y;
    
    // Animate smoothly
    setPanX(targetX);
    setPanY(targetY);
    setZoom(1.3);
  };

  const handleInconsistencyClick = (inc) => {
    setActiveAlertId(inc.id);
    setAgentStatus('action');
    
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

  const handleZoomReset = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
      {/* Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
            <ShieldAlert size={24} />
          </div>
          <div>
            <h4 style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 'bold', margin: 0 }}>Críticos</h4>
            <h3 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#1e293b', margin: 0 }}>
              {inconsistencies.filter(i => i.severity === 'critical').length}
            </h3>
          </div>
        </div>

        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <h4 style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 'bold', margin: 0 }}>Avisos</h4>
            <h3 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#1e293b', margin: 0 }}>
              {inconsistencies.filter(i => i.severity === 'warning').length}
            </h3>
          </div>
        </div>

        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e' }}>
            <CheckCircle2 size={24} />
          </div>
          <div>
            <h4 style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 'bold', margin: 0 }}>UCs Analisadas</h4>
            <h3 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#1e293b', margin: 0 }}>{ucs.length}</h3>
          </div>
        </div>

        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
            <FileText size={24} />
          </div>
          <div>
            <h4 style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 'bold', margin: 0 }}>Faturas Inspecionadas</h4>
            <h3 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#1e293b', margin: 0 }}>{invoices.length}</h3>
          </div>
        </div>
      </div>

      {/* Main Canvas + Sidebar Split */}
      <div className="auditor-container">
        
        {/* Obsidian Force-Directed Canvas */}
        <div 
          className="graph-canvas-container"
          ref={svgRef}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
        >
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
              </defs>

              <g transform={`translate(${panX}, ${panY}) scale(${zoom})`} style={{ pointerEvents: 'auto' }}>
                
                {/* 1. Links / Connections */}
                {links.map((link, idx) => {
                  const isHighlighted = hoveredNode && (hoveredNode.id === link.source || hoveredNode.id === link.target);
                  return (
                    <line
                      key={`link-${idx}`}
                      id={`link-${idx}`}
                      className="graph-link"
                      stroke={isHighlighted ? '#a855f7' : link.color}
                      strokeWidth={isHighlighted ? link.width + 1.5 : link.width}
                      opacity={isHighlighted ? 0.9 : 0.28}
                    />
                  );
                })}

                {/* 2. Glow ring around pulsing inconsistency nodes */}
                {nodes.map(node => {
                  if (!node.pulse) return null;
                  const isSelected = selectedNode && selectedNode.id === node.id;
                  return (
                    <circle
                      key={`ring-${node.id}`}
                      id={`ring-${node.id}`}
                      className="graph-node-pulse"
                      fill="none"
                      stroke={node.color}
                      strokeWidth={2}
                      opacity={isSelected ? 0.6 : 0.25}
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                })}

                {/* 3. Node Circles */}
                {nodes.map(node => {
                  const isSelected = selectedNode && selectedNode.id === node.id;
                  const isHovered = hoveredNode && hoveredNode.id === node.id;
                  const isDimmed = hoveredNode && !isHovered && 
                    !links.some(l => (l.source === node.id && l.target === hoveredNode.id) || (l.target === node.id && l.source === hoveredNode.id));

                  return (
                    <circle
                      key={node.id}
                      id={`circle-${node.id}`}
                      className="graph-node"
                      r={isSelected ? node.size + 4 : node.size}
                      fill={node.color}
                      stroke={isSelected ? '#ffffff' : (isHovered ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.3)')}
                      strokeWidth={isSelected ? 3 : 1.5}
                      filter={node.type === 'inconsistency' ? (node.severity === 'critical' ? 'url(#glow-error)' : 'url(#glow-warn)') : 'none'}
                      opacity={isDimmed ? 0.15 : 1}
                      style={{ transition: 'r 0.15s, opacity 0.2s', cursor: 'grab' }}
                      onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                      onClick={(e) => { e.stopPropagation(); handleNodeClick(node); }}
                      onMouseEnter={() => setHoveredNode(node)}
                      onMouseLeave={() => setHoveredNode(null)}
                    />
                  );
                })}

                {/* 4. Labels */}
                {nodes.map(node => {
                  const isSelected = selectedNode && selectedNode.id === node.id;
                  const isHovered = hoveredNode && hoveredNode.id === node.id;
                  const isDimmed = hoveredNode && !isHovered && 
                    !links.some(l => (l.source === node.id && l.target === hoveredNode.id) || (l.target === node.id && l.source === hoveredNode.id));

                  return (
                    <text
                      key={`label-${node.id}`}
                      id={`label-${node.id}`}
                      textAnchor="middle"
                      fill={isSelected ? '#ffffff' : '#94a3b8'}
                      fontSize={isSelected ? '10px' : '9px'}
                      fontWeight={isSelected ? 'bold' : 'normal'}
                      opacity={isDimmed ? 0.08 : 0.85}
                      style={{ pointerEvents: 'none', transition: 'opacity 0.2s', userSelect: 'none' }}
                    >
                      {node.label}
                    </text>
                  );
                })}

              </g>
            </svg>
          )}

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
            <button className="graph-control-btn" title="Centralizar Câmera" onClick={handleZoomReset}>
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

        {/* Auditor Sidebar Panel */}
        <div className="auditor-sidebar">
          
          <div className="auditor-sidebar-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ background: '#ef4444', width: '8px', height: '8px', borderRadius: '50%', boxShadow: '0 0 8px #ef4444' }}></div>
              <span style={{ fontSize: '0.85rem', fontWeight: '800', letterSpacing: '0.05em', color: '#ffffff' }}>PAINEL DE AUDITORIA</span>
            </div>
            <span style={{ background: 'rgba(255,255,255,0.08)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold' }}>
              {inconsistencies.length} CONFLITOS
            </span>
          </div>

          <div className="auditor-sidebar-content">
            
            {/* Agent Bubble (Avatar welcome and instruction) */}
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
                      onClick={() => handleInconsistencyClick(inc)}
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

                      <p style={{ fontSize: '0.7rem', color: '#cbd5e1', margin: '0 0 0.6rem 0', lineLineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {inc.description}
                      </p>

                      {/* Expanded alert cards show agential tools to execute fixes */}
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

      </div>
    </div>
  );
}
