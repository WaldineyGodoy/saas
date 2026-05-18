import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { 
  AlertTriangle, CheckCircle2, Zap, Settings, ZoomIn, ZoomOut, 
  Maximize, Play, Pause, RefreshCw, UserCheck, ShieldAlert, 
  FileText, X, Eye, EyeOff, ShieldCheck, ChevronRight, ChevronLeft, HelpCircle,
  User, DollarSign, Building, Layers, Globe, Search, ArrowRight, Activity
} from 'lucide-react';
import { useUI } from '../../contexts/UIContext';

export default function GraphNodeView() {
  const { showAlert } = useUI();
  const [loading, setLoading] = useState(true);
  
  // Entity raw lists loaded from DB
  const [leads, setLeads] = useState([]);
  const [originators, setOriginators] = useState([]);
  const [subscribers, setSubscribers] = useState([]);
  const [consumerUnits, setConsumerUnits] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [consolidatedInvoices, setConsolidatedInvoices] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [usinas, setUsinas] = useState([]);

  // Graph state lists
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);
  
  // Selection and hover focus states
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  
  // Real-time Autocomplete Autocomplete Query
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Graph UI Navigation Zoom & Panning
  const [zoom, setZoom] = useState(0.85);
  const [panX, setPanX] = useState(40);
  const [panY, setPanY] = useState(40);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sidebar control
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeLegendFilter, setActiveLegendFilter] = useState(null);
  
  // Graph Physics parameters
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [repulsion, setRepulsion] = useState(250);
  const [linkDistance, setLinkDistance] = useState(140);
  const [gravity, setGravity] = useState(0.15);

  // References for coordinates cache preservation during state changes (60 FPS Performance)
  const nodesStateRef = useRef([]);
  const draggingNodeIdRef = useRef(null);
  const dragStartCoordsRef = useRef({ x: 0, y: 0 });
  const graphContainerRef = useRef(null);

  const width = 1100;
  const height = 750;

  // Load all ecosystem records in parallel
  useEffect(() => {
    fetchEcosystemData();
  }, []);

  const fetchEcosystemData = async () => {
    setLoading(true);
    try {
      const [
        leadsRes,
        originatorsRes,
        subscribersRes,
        ucsRes,
        invoicesRes,
        consolidatedRes,
        suppliersRes,
        usinasRes
      ] = await Promise.all([
        supabase.from('leads').select('*'),
        supabase.from('originators_v2').select('*'),
        supabase.from('subscribers').select('*'),
        supabase.from('consumer_units').select('*'),
        supabase.from('invoices').select('*'),
        supabase.from('consolidated_invoices').select('*'),
        supabase.from('suppliers').select('*'),
        supabase.from('usinas').select('*')
      ]);

      setLeads(leadsRes.data || []);
      setOriginators(originatorsRes.data || []);
      setSubscribers(subscribersRes.data || []);
      setConsumerUnits(ucsRes.data || []);
      setInvoices(invoicesRes.data || []);
      setConsolidatedInvoices(consolidatedRes.data || []);
      setSuppliers(suppliersRes.data || []);
      setUsinas(usinasRes.data || []);

      buildGraph(
        leadsRes.data || [],
        originatorsRes.data || [],
        subscribersRes.data || [],
        ucsRes.data || [],
        invoicesRes.data || [],
        consolidatedRes.data || [],
        suppliersRes.data || [],
        usinasRes.data || []
      );
    } catch (err) {
      console.error('Erro ao buscar dados do grafo:', err);
      showAlert('Erro ao buscar conexões de rede do CRM.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Build network nodes and links
  const buildGraph = (
    allLeads,
    allOriginators,
    allSubscribers,
    allUcs,
    allInvoices,
    allConsol,
    allSuppliers,
    allUsinas
  ) => {
    const newNodes = [];
    const newLinks = [];

    // Coordinates mapping or preservation
    const setNodeCoords = (node) => {
      const existing = nodesStateRef.current?.find(n => n.id === node.id);
      if (existing && existing.x !== undefined && existing.y !== undefined) {
        node.x = existing.x;
        node.y = existing.y;
        node.vx = existing.vx || 0;
        node.vy = existing.vy || 0;
      } else {
        const angle = Math.random() * Math.PI * 2;
        const radius = 80 + Math.random() * 280;
        node.x = width / 2 + Math.cos(angle) * radius;
        node.y = height / 2 + Math.sin(angle) * radius;
        node.vx = 0;
        node.vy = 0;
      }
      return node;
    };

    // 1. Leads
    allLeads.forEach(lead => {
      const leadId = `lead_${lead.id}`;
      const node = {
        id: leadId,
        type: 'lead',
        label: lead.name || 'Lead Sem Nome',
        size: 13,
        rawData: lead
      };
      newNodes.push(setNodeCoords(node));

      if (lead.originator_id) {
        newLinks.push({
          source: leadId,
          target: `originator_${lead.originator_id}`,
          color: 'rgba(168, 85, 247, 0.22)',
          width: 1.2
        });
      }
    });

    // 2. Originators
    allOriginators.forEach(orig => {
      const origId = `originator_${orig.id}`;
      const node = {
        id: origId,
        type: 'originator',
        label: orig.name || 'Originador Sem Nome',
        size: 14,
        rawData: orig
      };
      newNodes.push(setNodeCoords(node));
    });

    // 3. Subscribers
    allSubscribers.forEach(sub => {
      const subId = `subscriber_${sub.id}`;
      const node = {
        id: subId,
        type: 'subscriber',
        label: sub.name || 'Assinante Sem Nome',
        size: 15,
        rawData: sub
      };
      newNodes.push(setNodeCoords(node));

      if (sub.originator_id) {
        newLinks.push({
          source: subId,
          target: `originator_${sub.originator_id}`,
          color: 'rgba(249, 115, 22, 0.25)',
          width: 1.2
        });
      }
      if (sub.lead_id) {
        newLinks.push({
          source: subId,
          target: `lead_${sub.lead_id}`,
          color: 'rgba(59, 130, 246, 0.22)',
          width: 1.2
        });
      }
    });

    // 4. Consumer Units (UCs)
    allUcs.forEach(uc => {
      const ucId = `uc_${uc.id}`;
      const node = {
        id: ucId,
        type: 'uc',
        label: `UC: ${uc.numero_uc} - ${uc.titular_conta || 'Sem Apelido'}`,
        size: 12,
        rawData: uc
      };
      newNodes.push(setNodeCoords(node));

      if (uc.subscriber_id) {
        newLinks.push({
          source: ucId,
          target: `subscriber_${uc.subscriber_id}`,
          color: 'rgba(34, 197, 94, 0.25)',
          width: 1.2
        });
      }
      if (uc.usina_id) {
        newLinks.push({
          source: ucId,
          target: `usina_${uc.usina_id}`,
          color: 'rgba(20, 184, 166, 0.22)',
          width: 1.2
        });
      }
      if (uc.concessionaria) {
        newLinks.push({
          source: ucId,
          target: `concessionaria_${uc.concessionaria}`,
          color: 'rgba(234, 179, 8, 0.2)',
          width: 1.2
        });
      }
    });

    // 5. Consolidated Invoices
    allConsol.forEach(fat => {
      const fatId = `fatura_${fat.id}`;
      const mesFormatted = fat.mes_referencia
        ? fat.mes_referencia.substring(5, 7) + '/' + fat.mes_referencia.substring(0, 4)
        : 'S/Ref';
      const valorStr = (Number(fat.total_value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      const node = {
        id: fatId,
        type: 'fatura',
        label: `Fatura: ${mesFormatted} - ${valorStr}`,
        size: 11,
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
    });

    // 6. Energy Accounts (Contas de energia)
    allInvoices.forEach(inv => {
      const invId = `conta_energia_${inv.id}`;
      const mesFormatted = inv.mes_referencia
        ? inv.mes_referencia.substring(5, 7) + '/' + inv.mes_referencia.substring(0, 4)
        : 'S/Ref';
      const valorStr = (Number(inv.valor_concessionaria) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      const node = {
        id: invId,
        type: 'conta_energia',
        label: `Conta: ${mesFormatted} - ${inv.consumo_compensado || 0} kWh - ${valorStr}`,
        size: 10,
        rawData: inv
      };
      newNodes.push(setNodeCoords(node));

      if (inv.uc_id) {
        newLinks.push({
          source: invId,
          target: `uc_${inv.uc_id}`,
          color: 'rgba(6, 182, 212, 0.22)',
          width: 1.2
        });
      }
      if (inv.consolidated_invoice_id) {
        newLinks.push({
          source: invId,
          target: `fatura_${inv.consolidated_invoice_id}`,
          color: 'rgba(236, 72, 153, 0.22)',
          width: 1.2
        });
      }
    });

    // 7. Suppliers
    allSuppliers.forEach(supp => {
      const suppId = `supplier_${supp.id}`;
      const node = {
        id: suppId,
        type: 'supplier',
        label: supp.name || 'Fornecedor Sem Nome',
        size: 13,
        rawData: supp
      };
      newNodes.push(setNodeCoords(node));
    });

    // 8. Plants (Usinas)
    allUsinas.forEach(u => {
      const uId = `usina_${u.id}`;
      const node = {
        id: uId,
        type: 'usina',
        label: u.name || 'Usina Sem Nome',
        size: 15,
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
    });

    // 9. Concessionarias
    const uniqueConcs = [...new Set([
      ...allUcs.map(u => u.concessionaria),
      ...allLeads.map(l => l.concessionaria),
      ...allUsinas.map(u => u.concessionaria)
    ].filter(Boolean))];

    uniqueConcs.forEach(concName => {
      const concId = `concessionaria_${concName}`;
      const node = {
        id: concId,
        type: 'concessionaria',
        label: `Distribuidora: ${concName}`,
        size: 14,
        rawData: { name: concName }
      };
      newNodes.push(setNodeCoords(node));
    });

    // Filter connections to guarantee both ends are visible
    const filteredNodes = newNodes;
    const filteredLinks = newLinks.filter(l => 
      filteredNodes.some(n => n.id === l.source) && 
      filteredNodes.some(n => n.id === l.target)
    );

    nodesStateRef.current = filteredNodes;
    setNodes(filteredNodes);
    setLinks(filteredLinks);
  };

  // Autocomplete filtering search
  const filteredSearchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase().trim();
    return nodes.filter(node => 
      node.label.toLowerCase().includes(query) ||
      node.type.toLowerCase().includes(query)
    ).slice(0, 8);
  }, [searchQuery, nodes]);

  // Physics animation tick frame handler (60 FPS DOM Mutations)
  useEffect(() => {
    if (!physicsEnabled || nodes.length === 0) return;
    let animationFrameId;

    const tick = () => {
      const currentNodes = nodesStateRef.current;
      if (!currentNodes || currentNodes.length === 0) return;

      // 1. Repel nodes
      for (let i = 0; i < currentNodes.length; i++) {
        const nodeA = currentNodes[i];
        for (let j = i + 1; j < currentNodes.length; j++) {
          const nodeB = currentNodes[j];
          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const distSq = dx * dx + dy * dy + 1;
          const dist = Math.sqrt(distSq);

          let effectiveRepulsion = repulsion;
          let repelThreshold = 260;

          // Push active matching nodes significantly further apart to avoid overlapping labels (Melhoria 5)
          if (activeLegendFilter && nodeA.type === activeLegendFilter && nodeB.type === activeLegendFilter) {
            effectiveRepulsion = repulsion * 3.5;
            repelThreshold = 400;
          }

          // If a node is selected, also push all connected nodes further apart from it and from each other
          if (selectedNode) {
            const isAConnected = nodeA.id === selectedNode.id || links.some(l => 
              (l.source === selectedNode.id && l.target === nodeA.id) ||
              (l.target === selectedNode.id && l.source === nodeA.id)
            );
            const isBConnected = nodeB.id === selectedNode.id || links.some(l => 
              (l.source === selectedNode.id && l.target === nodeB.id) ||
              (l.target === selectedNode.id && l.source === nodeB.id)
            );
            if (isAConnected && isBConnected) {
              effectiveRepulsion = repulsion * 2.8;
              repelThreshold = 350;
            }
          }

          if (dist < repelThreshold) {
            const force = effectiveRepulsion / distSq;
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

      // 2. Attract connected links
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const sourceNode = currentNodes.find(n => n.id === link.source);
        const targetNode = currentNodes.find(n => n.id === link.target);

        if (sourceNode && targetNode) {
          const dx = targetNode.x - sourceNode.x;
          const dy = targetNode.y - sourceNode.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
          const displacement = dist - linkDistance;
          const force = displacement * 0.045;

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

      // 3. Apply gravity centering
      const centerX = width / 2;
      const centerY = height / 2;
      const damping = 0.83;

      for (let i = 0; i < currentNodes.length; i++) {
        const node = currentNodes[i];
        if (draggingNodeIdRef.current === node.id) continue;

        const dx = centerX - node.x;
        const dy = centerY - node.y;
        node.vx += dx * gravity * 0.1;
        node.vy += dy * gravity * 0.1;

        node.x += node.vx;
        node.y += node.vy;
        node.vx *= damping;
        node.vy *= damping;
      }

      // 4. Update elements directly on DOM for 60 FPS speed
      currentNodes.forEach(node => {
        const circle = document.getElementById(`gen-circle-${node.id}`);
        const ring = document.getElementById(`gen-ring-${node.id}`);
        const label = document.getElementById(`gen-label-${node.id}`);
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
        const line = document.getElementById(`gen-link-${idx}`);
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
  }, [nodes, links, physicsEnabled, repulsion, linkDistance, gravity, activeLegendFilter, selectedNode]);

  // Smooth Mouse Scroll Zoom Handler (Melhoria 6)
  useEffect(() => {
    const container = graphContainerRef.current;
    if (!container) return;

    const handleWheelEvent = (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      setZoom(prev => {
        const nextZoom = prev * zoomFactor;
        return Math.max(0.35, Math.min(nextZoom, 2.5));
      });
    };

    container.addEventListener('wheel', handleWheelEvent, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheelEvent);
    };
  }, []);

  // Center view on a selected search node
  const handleSelectSearchNode = (node) => {
    setSelectedNode(node);
    setSearchQuery('');
    setShowSearchResults(false);

    if (node.x !== undefined && node.y !== undefined) {
      setPanX(width / 2 - node.x * zoom);
      setPanY(height / 2 - node.y * zoom);
    }
  };

  // Node Clicking Focus Routing
  const handleNodeClick = (node) => {
    setSelectedNode(node);
  };

  // Dragging Implementation
  const handleNodeMouseDown = (e, nodeId) => {
    e.stopPropagation();
    e.preventDefault();
    draggingNodeIdRef.current = nodeId;
    const clientX = e.clientX;
    const clientY = e.clientY;
    dragStartCoordsRef.current = { clientX, clientY };

    window.addEventListener('mousemove', handleNodeMouseMove);
    window.addEventListener('mouseup', handleNodeMouseUp);
  };

  const handleNodeMouseMove = (e) => {
    if (!draggingNodeIdRef.current) return;
    const currentNodes = nodesStateRef.current;
    const node = currentNodes.find(n => n.id === draggingNodeIdRef.current);
    if (node) {
      const containerRect = graphContainerRef.current?.getBoundingClientRect();
      if (containerRect) {
        node.x = (e.clientX - containerRect.left - panX) / zoom;
        node.y = (e.clientY - containerRect.top - panY) / zoom;
        node.vx = 0;
        node.vy = 0;
      }
    }
  };

  const handleNodeMouseUp = () => {
    draggingNodeIdRef.current = null;
    window.removeEventListener('mousemove', handleNodeMouseMove);
    window.removeEventListener('mouseup', handleNodeMouseUp);
  };

  // Canvas Panning Implementation
  const handleCanvasMouseDown = (e) => {
    if (e.target.tagName === 'circle' || e.target.tagName === 'button' || e.target.closest('.search-box')) return;
    const startX = e.clientX - panX;
    const startY = e.clientY - panY;

    const onMouseMove = (moveEvent) => {
      setPanX(moveEvent.clientX - startX);
      setPanY(moveEvent.clientY - startY);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const triggerReload = () => {
    setSelectedNode(null);
    setHoveredNode(null);
    setActiveLegendFilter(null);
    setPanX(40);
    setPanY(40);
    setZoom(0.85);
    nodesStateRef.current = [];
    fetchEcosystemData();
  };

  // Inspect Modal contents custom builders
  const renderSidebarDetails = () => {
    if (!selectedNode) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', padding: '2rem', textAlign: 'center', gap: '1rem' }}>
          <Globe size={40} style={{ opacity: 0.35, color: '#FF6600' }} />
          <div>
            <h4 style={{ color: '#e2e8f0', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '4px' }}>SELECIONE UM NÓ</h4>
            <p style={{ fontSize: '0.7rem' }}>Clique em qualquer entidade no grafo de rede ou use o autocompletar para visualizar os detalhes, conexões e ações diretas.</p>
          </div>
        </div>
      );
    }

    const { type, rawData } = selectedNode;
    let badgeColor = '#FF6600';
    let typeLabel = 'Entidade';
    let icon = <Globe size={18} />;

    switch (type) {
      case 'lead':
        badgeColor = '#a855f7';
        typeLabel = 'Lead / Prospecção';
        icon = <User size={18} />;
        break;
      case 'originator':
        badgeColor = '#f97316';
        typeLabel = 'Originador / Parceiro';
        icon = <Zap size={18} />;
        break;
      case 'subscriber':
        badgeColor = '#3b82f6';
        typeLabel = 'Assinante / Consumidor';
        icon = <UserCheck size={18} />;
        break;
      case 'uc':
        badgeColor = '#22c55e';
        typeLabel = 'Unidade Consumidora (UC)';
        icon = <Building size={18} />;
        break;
      case 'fatura':
        badgeColor = '#ec4899';
        typeLabel = 'Fatura Consolidada';
        icon = <FileText size={18} />;
        break;
      case 'conta_energia':
        badgeColor = '#06b6d4';
        typeLabel = 'Conta Distribuidora';
        icon = <Layers size={18} />;
        break;
      case 'supplier':
        badgeColor = '#8b5cf6';
        typeLabel = 'Fornecedor';
        icon = <Layers size={18} />;
        break;
      case 'usina':
        badgeColor = '#14b8a6';
        typeLabel = 'Usina de Geração';
        icon = <Building size={18} />;
        break;
      case 'concessionaria':
        badgeColor = '#eab308';
        typeLabel = 'Concessionária Local';
        icon = <Layers size={18} />;
        break;
    }

    // Connections count
    const connections = links.filter(l => l.source === selectedNode.id || l.target === selectedNode.id);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.25rem', height: '100%', overflowY: 'auto' }}>
        {/* Header Badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `${badgeColor}15`,
              color: badgeColor,
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              border: `1px solid ${badgeColor}40`,
              boxShadow: `0 0 10px ${badgeColor}15`
            }}>
              {icon}
            </span>
            <div>
              <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: badgeColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{typeLabel}</span>
              <h3 style={{ fontSize: '0.9rem', fontWeight: '800', color: '#ffffff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px', whiteSpace: 'nowrap' }}>{selectedNode.label.split(': ').pop()}</h3>
            </div>
          </div>
          <button 
            onClick={() => setSelectedNode(null)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Entity specific attributes details */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h4 style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Propriedades do Registro</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.75rem' }}>
              {type === 'lead' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Status:</span><span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>{rawData.status || 'Em Prospecção'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Email:</span><span style={{ color: '#e2e8f0' }}>{rawData.email || '-'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Telefone:</span><span style={{ color: '#e2e8f0' }}>{rawData.phone || '-'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Concessionária:</span><span style={{ color: '#eab308', fontWeight: 'bold' }}>{rawData.concessionaria || '-'}</span></div>
                </>
              )}
              {type === 'originator' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Nome Curto:</span><span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>{rawData.short_name || rawData.name}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>E-mail corporativo:</span><span style={{ color: '#e2e8f0' }}>{rawData.corporate_email || '-'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Comissão (%):</span><span style={{ color: '#f97316', fontWeight: 'bold' }}>{rawData.commission_rate || '1.5'}%</span></div>
                </>
              )}
              {type === 'subscriber' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Código Assinante:</span><span style={{ color: '#cbd5e1', fontWeight: 'bold' }}>#{rawData.id.substring(0, 8)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Status:</span><span style={{ color: rawData.status === 'ativo' ? '#22c55e' : '#f59e0b', fontWeight: 'bold' }}>{rawData.status}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Documento (CPF/CNPJ):</span><span style={{ color: '#e2e8f0' }}>{rawData.document_number || '-'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Assinatura Ativa:</span><span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{rawData.has_active_signature ? 'Sim' : 'Não'}</span></div>
                </>
              )}
              {type === 'uc' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Número UC:</span><span style={{ color: '#cbd5e1', fontWeight: 'bold' }}>{rawData.numero_uc}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Titular Conta:</span><span style={{ color: '#e2e8f0' }}>{rawData.titular_conta}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Modalidade:</span><span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>{rawData.modalidade}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Desconto Assinante:</span><span style={{ color: '#22c55e', fontWeight: 'bold' }}>{rawData.desconto_assinante}%</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Status:</span><span style={{ color: rawData.status === 'ativo' ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>{rawData.status}</span></div>
                </>
              )}
              {type === 'fatura' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Período Referência:</span><span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>{rawData.mes_referencia}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Valor Fatura:</span><span style={{ color: '#ec4899', fontWeight: 'bold' }}>R$ {(Number(rawData.total_value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Status de Pagamento:</span><span style={{ color: rawData.status === 'paga' ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>{rawData.status}</span></div>
                </>
              )}
              {type === 'conta_energia' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Distribuidora:</span><span style={{ color: '#eab308', fontWeight: 'bold' }}>{rawData.concessionaria || '-'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Consumo Compensado:</span><span style={{ color: '#06b6d4', fontWeight: 'bold' }}>{rawData.consumo_compensado} kWh</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Valor Distribuidora:</span><span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>R$ {(Number(rawData.valor_concessionaria) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Tarifa Aplicada:</span><span style={{ color: '#cbd5e1' }}>R$ {rawData.valor_tarifa || '-'}</span></div>
                </>
              )}
              {type === 'usina' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Nome Usina:</span><span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>{rawData.name}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Capacidade (kWp):</span><span style={{ color: '#14b8a6', fontWeight: 'bold' }}>{rawData.capacity_kwp || '-'} kWp</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Distribuidora Local:</span><span style={{ color: '#eab308', fontWeight: 'bold' }}>{rawData.concessionaria}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Status Operação:</span><span style={{ color: rawData.status === 'ativo' ? '#22c55e' : '#f59e0b', fontWeight: 'bold' }}>{rawData.status}</span></div>
                </>
              )}
              {type === 'supplier' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Nome Fantasia:</span><span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>{rawData.name}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>CNPJ Fornecedor:</span><span style={{ color: '#cbd5e1' }}>{rawData.cnpj || '-'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Status:</span><span style={{ color: rawData.status === 'ativo' ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>{rawData.status}</span></div>
                </>
              )}
              {type === 'concessionaria' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Nome Distribuidora:</span><span style={{ color: '#eab308', fontWeight: 'bold' }}>{rawData.name}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Tipo:</span><span style={{ color: '#e2e8f0' }}>Distribuidora Concessionária Autorizada</span></div>
                </>
              )}
            </div>
          </div>

          {/* Connected entities list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <h4 style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vínculos de Rede ({connections.length})</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
              {connections.map((link, idx) => {
                const otherNode = nodes.find(n => n.id === (link.source === selectedNode.id ? link.target : link.source));
                if (!otherNode) return null;
                return (
                  <div 
                    key={idx}
                    onClick={() => handleSelectSearchNode(otherNode)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      fontSize: '0.72rem'
                    }}
                    onMouseOver={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                      e.currentTarget.style.border = '1px solid rgba(255, 102, 0, 0.35)';
                    }}
                    onMouseOut={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                      e.currentTarget.style.border = '1px solid rgba(255,255,255,0.05)';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#e2e8f0' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#FF6600' }}></span>
                      <span style={{ fontWeight: '600' }}>{otherNode.label.split(': ').pop()}</span>
                    </div>
                    <span style={{ fontSize: '0.62rem', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px', color: '#94a3b8', textTransform: 'uppercase' }}>
                      {otherNode.type}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Action button */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
          <button
            onClick={() => {
              showAlert(`Inspecionando entidade ${selectedNode.label.split(': ').pop()} no painel do CRM`, 'success');
            }}
            style={{
              width: '100%',
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
            <Activity size={14} /> Focar no Cadastro Principal
          </button>
        </div>
      </div>
    );
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Graph Node View (Obsidian Style)</span>
          <span style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', color: '#94a3b8', fontWeight: 'bold' }}>
            {nodes.length} Entidades Ativas
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: '#ffffff' }}>
          <span style={{ color: '#ffffff', fontWeight: '500' }}>Status do Ecossistema:</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#22c55e', fontWeight: 'bold' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', boxShadow: '0 0 8px #22c55e' }}></span>
            Rede Mapeada (Real-Time)
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

        {/* CRM Network Sidebar Panel */}
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
              <div style={{ background: '#FF6600', width: '8px', height: '8px', borderRadius: '50%', boxShadow: '0 0 8px #FF6600' }}></div>
              <span style={{ fontSize: '0.85rem', fontWeight: '800', letterSpacing: '0.05em', color: '#ffffff' }}>INSPEÇÃO DE REDE</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                  justifyContent: 'center'
                }}
                title="Recolher Painel"
              >
                <ChevronLeft size={20} />
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {renderSidebarDetails()}
          </div>
        </div>

        {/* Sidebar Toggle Handle */}
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            style={{
              position: 'absolute',
              left: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 50,
              background: '#090d16',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderLeft: 'none',
              color: '#ffffff',
              borderRadius: '0 8px 8px 0',
              width: '24px',
              height: '48px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '4px 0 16px rgba(0,0,0,0.5)',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={e => e.currentTarget.style.color = '#FF6600'}
            onMouseOut={e => e.currentTarget.style.color = '#ffffff'}
          >
            <ChevronRight size={18} />
          </button>
        )}

        {/* Network Physics Graph Area */}
        <div 
          className="auditor-canvas-container"
          style={{
            flex: 1,
            position: 'relative',
            height: '100%',
            overflow: 'hidden',
            background: '#030712'
          }}
          onMouseDown={handleCanvasMouseDown}
        >
          {loading && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: 999,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(3, 7, 18, 0.85)',
              backdropFilter: 'blur(12px)',
              gap: '1rem'
            }}>
              <div className="agent-radar" style={{ border: '2px solid rgba(255, 102, 0, 0.15)', width: '120px', height: '120px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: '80px', height: '80px', border: '3px solid transparent', borderTopColor: '#FF6600', borderRadius: '50%', animation: 'spin 1.5s linear infinite' }}></div>
              </div>
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ffffff' }}>Mapeando Conexões e Links do CRM...</span>
            </div>
          )}

          {/* Autocomplete Search Overlay inside Canvas Container */}
          <div className="search-box" style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            zIndex: 40,
            width: '280px',
            pointerEvents: 'auto'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 102, 0, 0.35)',
              borderRadius: '8px',
              padding: '6px 12px',
              gap: '0.5rem',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
            }}>
              <Search size={14} style={{ color: '#FF6600' }} />
              <input
                type="text"
                placeholder="Pesquisar Entidade..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSearchResults(true);
                }}
                onFocus={() => setShowSearchResults(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  color: '#ffffff',
                  fontSize: '0.75rem',
                  width: '100%',
                  fontWeight: '500'
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {showSearchResults && filteredSearchResults.length > 0 && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                width: '100%',
                background: 'rgba(15, 23, 42, 0.95)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                maxHeight: '260px',
                overflowY: 'auto'
              }}>
                {filteredSearchResults.map((node) => {
                  let typeColor = '#FF6600';
                  if (node.type === 'lead') typeColor = '#a855f7';
                  else if (node.type === 'subscriber') typeColor = '#3b82f6';
                  else if (node.type === 'uc') typeColor = '#22c55e';
                  else if (node.type === 'fatura') typeColor = '#ec4899';
                  else if (node.type === 'conta_energia') typeColor = '#06b6d4';

                  return (
                    <div
                      key={node.id}
                      onClick={() => handleSelectSearchNode(node)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                      onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#ffffff' }}>
                        {node.label.split(': ').pop()}
                      </span>
                      <span style={{ fontSize: '0.58rem', color: typeColor, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {node.type}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Legends Filters Overlay inside Canvas Container */}
          <div style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            zIndex: 40,
            display: 'flex',
            flexDirection: 'row',
            gap: '0.5rem',
            background: 'rgba(9, 13, 22, 0.65)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            padding: '5px 10px',
            borderRadius: '20px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            pointerEvents: 'auto',
            userSelect: 'none'
          }}>
            {/* Leads Legend Button */}
            <button
              onClick={(e) => { e.stopPropagation(); setActiveLegendFilter(prev => prev === 'lead' ? null : 'lead'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: activeLegendFilter === 'lead' ? 'rgba(168, 85, 247, 0.45)' : 'rgba(168, 85, 247, 0.1)',
                border: activeLegendFilter === 'lead' ? '2px solid #a855f7' : '1px solid rgba(168, 85, 247, 0.25)',
                color: '#c084fc',
                padding: '4px 10px',
                borderRadius: '15px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeLegendFilter === 'lead' ? '0 0 16px rgba(168, 85, 247, 0.6)' : 'none'
              }}
            >
              <User size={11} />
              <span>Leads</span>
            </button>

            {/* Originadores Legend Button */}
            <button
              onClick={(e) => { e.stopPropagation(); setActiveLegendFilter(prev => prev === 'originator' ? null : 'originator'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: activeLegendFilter === 'originator' ? 'rgba(249, 115, 22, 0.45)' : 'rgba(249, 115, 22, 0.1)',
                border: activeLegendFilter === 'originator' ? '2px solid #f97316' : '1px solid rgba(249, 115, 22, 0.25)',
                color: '#fb923c',
                padding: '4px 10px',
                borderRadius: '15px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeLegendFilter === 'originator' ? '0 0 16px rgba(249, 115, 22, 0.6)' : 'none'
              }}
            >
              <Zap size={11} />
              <span>Originadores</span>
            </button>

            {/* Assinantes Legend Button */}
            <button
              onClick={(e) => { e.stopPropagation(); setActiveLegendFilter(prev => prev === 'subscriber' ? null : 'subscriber'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: activeLegendFilter === 'subscriber' ? 'rgba(59, 130, 246, 0.45)' : 'rgba(59, 130, 246, 0.1)',
                border: activeLegendFilter === 'subscriber' ? '2px solid #3b82f6' : '1px solid rgba(59, 130, 246, 0.25)',
                color: '#60a5fa',
                padding: '4px 10px',
                borderRadius: '15px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeLegendFilter === 'subscriber' ? '0 0 16px rgba(59, 130, 246, 0.6)' : 'none'
              }}
            >
              <UserCheck size={11} />
              <span>Assinantes</span>
            </button>

            {/* UCs Legend Button */}
            <button
              onClick={(e) => { e.stopPropagation(); setActiveLegendFilter(prev => prev === 'uc' ? null : 'uc'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: activeLegendFilter === 'uc' ? 'rgba(34, 197, 94, 0.45)' : 'rgba(34, 197, 94, 0.1)',
                border: activeLegendFilter === 'uc' ? '2px solid #22c55e' : '1px solid rgba(34, 197, 94, 0.25)',
                color: '#4ade80',
                padding: '4px 10px',
                borderRadius: '15px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeLegendFilter === 'uc' ? '0 0 16px rgba(34, 197, 94, 0.6)' : 'none'
              }}
            >
              <Building size={11} />
              <span>UCs</span>
            </button>

            {/* Faturas Legend Button */}
            <button
              onClick={(e) => { e.stopPropagation(); setActiveLegendFilter(prev => prev === 'fatura' ? null : 'fatura'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: activeLegendFilter === 'fatura' ? 'rgba(236, 72, 153, 0.45)' : 'rgba(236, 72, 153, 0.1)',
                border: activeLegendFilter === 'fatura' ? '2px solid #ec4899' : '1px solid rgba(236, 72, 153, 0.25)',
                color: '#f472b6',
                padding: '4px 10px',
                borderRadius: '15px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeLegendFilter === 'fatura' ? '0 0 16px rgba(236, 72, 153, 0.6)' : 'none'
              }}
            >
              <FileText size={11} />
              <span>Faturas</span>
            </button>

            {/* Contas de Energia Legend Button */}
            <button
              onClick={(e) => { e.stopPropagation(); setActiveLegendFilter(prev => prev === 'conta_energia' ? null : 'conta_energia'); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: activeLegendFilter === 'conta_energia' ? 'rgba(6, 182, 212, 0.45)' : 'rgba(6, 182, 212, 0.1)',
                border: activeLegendFilter === 'conta_energia' ? '2px solid #06b6d4' : '1px solid rgba(6, 182, 212, 0.25)',
                color: '#22d3ee',
                padding: '4px 10px',
                borderRadius: '15px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeLegendFilter === 'conta_energia' ? '0 0 16px rgba(6, 182, 212, 0.6)' : 'none'
              }}
            >
              <Layers size={11} />
              <span>Contas de Energia</span>
            </button>
          </div>

          {/* Canvas Floating controls */}
          <div style={{
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            zIndex: 40,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            pointerEvents: 'auto'
          }}>
            {/* Simulation controls toggle */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease'
              }}
              title="Configurações de Física"
              onMouseOver={e => e.currentTarget.style.border = '1px solid #FF6600'}
              onMouseOut={e => e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.08)'}
            >
              <Settings size={18} />
            </button>

            <button
              onClick={() => setZoom(prev => Math.min(prev + 0.1, 2.5))}
              style={{
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease'
              }}
            >
              <ZoomIn size={18} />
            </button>

            <button
              onClick={() => setZoom(prev => Math.max(prev - 0.1, 0.35))}
              style={{
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease'
              }}
            >
              <ZoomOut size={18} />
            </button>

            <button
              onClick={() => {
                setPanX(40);
                setPanY(40);
                setZoom(0.85);
              }}
              style={{
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease'
              }}
              title="Centralizar Câmera"
            >
              <Maximize size={18} />
            </button>

            <button
              onClick={triggerReload}
              style={{
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease'
              }}
              title="Limpar Seleção e Recarregar"
            >
              <RefreshCw size={18} />
            </button>

            <button
              onClick={() => setPhysicsEnabled(!physicsEnabled)}
              style={{
                background: physicsEnabled ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                border: physicsEnabled ? '1px solid #22c55e' : '1px solid #ef4444',
                color: physicsEnabled ? '#22c55e' : '#ef4444',
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease'
              }}
              title={physicsEnabled ? "Pausar Física" : "Iniciar Física"}
            >
              {physicsEnabled ? <Pause size={18} /> : <Play size={18} />}
            </button>
          </div>

          {/* Floating settings drawer */}
          {showSettings && (
            <div style={{
              position: 'absolute',
              bottom: '68px',
              right: '16px',
              zIndex: 45,
              width: '240px',
              background: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.85rem',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              pointerEvents: 'auto'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#ffffff' }}>PARÂMETROS DE FÍSICA</span>
                <button
                  onClick={() => setShowSettings(false)}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
                >
                  <X size={14} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.65rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                    <span>Repulsão:</span>
                    <span>{repulsion}</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="600"
                    value={repulsion}
                    onChange={(e) => setRepulsion(Number(e.target.value))}
                    style={{ accentColor: '#FF6600', cursor: 'pointer' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                    <span>Distância do Vínculo:</span>
                    <span>{linkDistance}px</span>
                  </div>
                  <input
                    type="range"
                    min="60"
                    max="300"
                    value={linkDistance}
                    onChange={(e) => setLinkDistance(Number(e.target.value))}
                    style={{ accentColor: '#FF6600', cursor: 'pointer' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                    <span>Gravidade (Força):</span>
                    <span>{gravity.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.01"
                    max="0.5"
                    step="0.01"
                    value={gravity}
                    onChange={(e) => setGravity(Number(e.target.value))}
                    style={{ accentColor: '#FF6600', cursor: 'pointer' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* SVG physics graph canvas */}
          <div 
            ref={graphContainerRef}
            style={{ width: '100%', height: '100%', cursor: draggingNodeIdRef.current ? 'grabbing' : 'grab' }}
          >
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${width} ${height}`}
              style={{ display: 'block' }}
            >
              <defs>
                {/* Silver Gradient definitions for high quality nodes styling */}
                <linearGradient id="silver-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="25%" stopColor="#f1f5f9" />
                  <stop offset="50%" stopColor="#94a3b8" />
                  <stop offset="75%" stopColor="#cbd5e1" />
                  <stop offset="100%" stopColor="#334155" />
                </linearGradient>

                {/* Neon filters */}
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

                <filter id="glow-warn" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feColorMatrix type="matrix" values="
                    0 0 0 0 0   
                    0 0 0 0 0   
                    0 1 1 0 0.8   
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
                  
                  const sourceMatches = sourceNode && (!activeLegendFilter || sourceNode.type === activeLegendFilter);
                  const targetMatches = targetNode && (!activeLegendFilter || targetNode.type === activeLegendFilter);
                  
                  const isHighlighted = hoveredNode && (hoveredNode.id === link.source || hoveredNode.id === link.target);
                  const isLinkSelected = selectedNode && (selectedNode.id === link.source || selectedNode.id === link.target);
                  const isLinkDimmedByLegend = activeLegendFilter && (!sourceMatches || !targetMatches);
                  
                  // Highlight persistence rules
                  const isDimmedLink = isLinkDimmedByLegend || (
                    selectedNode 
                      ? (!isLinkSelected && (!hoveredNode || !isHighlighted))
                      : (hoveredNode && !isHighlighted)
                  );
                  
                  let linkStroke = isLinkSelected ? '#ffffff' : (isHighlighted ? '#FF6600' : link.color);
                  if (isDimmedLink) {
                    linkStroke = '#111622';
                  }
                  
                  return (
                    <line
                      key={`gen-link-${idx}`}
                      id={`gen-link-${idx}`}
                      x1={sourceNode?.x ?? 0}
                      y1={sourceNode?.y ?? 0}
                      x2={targetNode?.x ?? 0}
                      y2={targetNode?.y ?? 0}
                      stroke={linkStroke}
                      strokeWidth={isLinkSelected ? link.width + 3 : (isHighlighted ? link.width + 1.2 : link.width)}
                      opacity={isLinkSelected ? 0.95 : (isDimmedLink ? 0.05 : 0.28)}
                      filter={isLinkSelected ? 'url(#glow-silver)' : undefined}
                    />
                  );
                })}

                {/* 2. Glow ring around focused status nodes */}
                {nodes.map(node => {
                  const isSelected = selectedNode && selectedNode.id === node.id;
                  const isHovered = hoveredNode && hoveredNode.id === node.id;
                  const isConnectedToSelected = selectedNode && links.some(l => 
                    (l.source === selectedNode.id && l.target === node.id) ||
                    (l.target === selectedNode.id && l.source === node.id)
                  );
                  
                  const matchesLegendFilter = !activeLegendFilter || node.type === activeLegendFilter;
                  // Selected or connected nodes are NEVER dimmed by legend filters (Melhoria 3)
                  const isDimmedByLegend = activeLegendFilter && !matchesLegendFilter && !isSelected && !isConnectedToSelected;
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

                  const showRing = isSelected || isHovered || isConnectedToSelected || (activeLegendFilter && matchesLegendFilter);
                  if (!showRing) return null;

                  let ringStroke = '#ffffff';
                  let ringFilter = 'url(#glow-silver)';
                  
                  if (node.type === 'lead') {
                    ringStroke = '#a855f7';
                    ringFilter = 'url(#glow-primary)';
                  } else if (node.type === 'originator') {
                    ringStroke = '#f97316';
                    ringFilter = 'url(#glow-primary)';
                  } else if (node.type === 'subscriber') {
                    ringStroke = '#3b82f6';
                    ringFilter = 'url(#glow-primary)';
                  } else if (node.type === 'uc') {
                    ringStroke = '#22c55e';
                    ringFilter = 'url(#glow-success)';
                  } else if (node.type === 'fatura') {
                    ringStroke = '#ec4899';
                    ringFilter = 'url(#glow-primary)';
                  } else if (node.type === 'conta_energia') {
                    ringStroke = '#06b6d4';
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
                      key={`gen-ring-${node.id}`}
                      id={`gen-ring-${node.id}`}
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
                  
                  const matchesLegendFilter = !activeLegendFilter || node.type === activeLegendFilter;
                  // Selected or connected nodes are NEVER dimmed by legend filters (Melhoria 3)
                  const isDimmedByLegend = activeLegendFilter && !matchesLegendFilter && !isSelected && !isConnectedToSelected;
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
                  let nodeStroke = 'rgba(255, 255, 255, 0.2)';
                  let nodeFilter = 'url(#glow-silver)';

                  // Compute entity status colors dynamically
                  let entityColor = '#ffffff';
                  let entityFilter = 'url(#glow-silver)';
                  if (node.type === 'lead') {
                    entityColor = '#a855f7';
                    entityFilter = 'url(#glow-primary)';
                  } else if (node.type === 'originator') {
                    entityColor = '#f97316';
                    entityFilter = 'url(#glow-primary)';
                  } else if (node.type === 'subscriber') {
                    entityColor = '#3b82f6';
                    entityFilter = 'url(#glow-primary)';
                  } else if (node.type === 'uc') {
                    entityColor = '#22c55e';
                    entityFilter = 'url(#glow-success)';
                  } else if (node.type === 'fatura') {
                    entityColor = '#ec4899';
                    entityFilter = 'url(#glow-primary)';
                  } else if (node.type === 'conta_energia') {
                    entityColor = '#06b6d4';
                    entityFilter = 'url(#glow-primary)';
                  } else if (node.type === 'supplier') {
                    entityColor = '#8b5cf6';
                    entityFilter = 'url(#glow-primary)';
                  } else if (node.type === 'usina') {
                    entityColor = '#14b8a6';
                    entityFilter = 'url(#glow-primary)';
                  } else if (node.type === 'concessionaria') {
                    entityColor = '#eab308';
                    entityFilter = 'url(#glow-warn)';
                  }

                  if (activeLegendFilter) {
                    if (matchesLegendFilter) {
                      nodeFill = entityColor;
                      nodeStroke = entityColor; // Status color border! (Melhoria 4)
                      nodeFilter = entityFilter;
                    } else {
                      nodeFill = '#111622';
                      nodeStroke = 'rgba(255, 255, 255, 0.03)';
                      nodeFilter = 'none';
                    }
                  } else if (selectedNode) {
                    if (isSelected) {
                      nodeFill = entityColor;
                      nodeStroke = entityColor; // Status color border! (Melhoria 4)
                      nodeFilter = entityFilter;
                    } else if (isConnectedToSelected) {
                      nodeFill = entityColor; // Colored dynamically in entity color! (Melhoria 2)
                      nodeStroke = entityColor; // Status color border! (Melhoria 4)
                      nodeFilter = entityFilter;
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
                      id={`gen-circle-${node.id}`}
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
                  const isConnectedToSelected = selectedNode && links.some(l => 
                    (l.source === selectedNode.id && l.target === node.id) ||
                    (l.target === selectedNode.id && l.source === node.id)
                  );
                  
                  const matchesLegendFilter = !activeLegendFilter || node.type === activeLegendFilter;
                  // Selected or connected nodes are NEVER dimmed by legend filters (Melhoria 3)
                  const isDimmedByLegend = activeLegendFilter && !matchesLegendFilter && !isSelected && !isConnectedToSelected;
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
                      key={`gen-label-${node.id}`}
                      id={`gen-label-${node.id}`}
                      x={node.x ?? 0}
                      y={(node.y ?? 0) + node.size + 14}
                      textAnchor="middle"
                      fill={isSelected ? '#ffffff' : (isConnectedToSelected ? '#e2e8f0' : '#94a3b8')}
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
          </div>

        </div>

      </div>

    </div>
  );
}
