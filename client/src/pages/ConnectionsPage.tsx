import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Network, Loader2, Eye, Pencil, Route } from 'lucide-react';
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, Simulation } from 'd3-force';
import { zoom, zoomIdentity, ZoomBehavior } from 'd3-zoom';
import { select } from 'd3-selection';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { apiFetch } from '../hooks/useApi';
import { svgElementToPngDataUrl, downloadDataUrl } from '../utils/graphToPng';
import { exportGraphToPdf } from '../utils/graphToPdf';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import RichTextArea from '../components/RichTextArea';
import { NODE_COLORS, NODE_RADIUS } from '../utils/connectionsGraphStyle';
import ConnectionsMapPanel from '../components/ConnectionsMapPanel';
import { formatEnumValue } from '../utils/formatters';
import { useSlashFocus } from '../hooks/useSlashFocus';
import { connectionSeedsToCsv, downloadTextFile } from '../utils/rmsListExport';

interface SearchResult { id: number; type: string; label: string; }
interface Seed { id: number; type: string; label: string; }

interface ServerNode {
  id: string;
  type: string;
  entityId: number;
  label: string;
  metadata: Record<string, any>;
  depth: number;
}
interface ServerEdge {
  source: string;
  target: string;
  relationship: string;
  sourceTable: string;
}

interface SimNode extends ServerNode {
  x: number; y: number;
  vx?: number; vy?: number;
  fx?: number | null; fy?: number | null;
}
interface SimEdge {
  source: SimNode | string;
  target: SimNode | string;
  relationship: string;
  sourceTable: string;
}

// Timeline-drawer colors — mirror NODE_COLORS exactly so the same entity
// type renders the same dot color in both the graph AND the timeline.
// Previously this map drifted: case used brand-gold (collided with the
// person-node color in the graph) and arrest used the same red as
// evidence. Re-aligned 2026-06-22.
const TIMELINE_KIND_COLOR: Record<string, string> = {
  intel:           '#e879f9', // fuchsia (matches intel_report)
  incident:        '#f59e0b',
  call:            '#22d3ee',
  citation:        '#fbbf24',
  warrant:         '#dc2626',
  arrest:          '#f43f5e', // was '#ef4444' — collided with evidence
  field_interview: '#64748b',
  trespass_order:  '#a855f7',
  case:            '#84cc16', // was '#d4a017' — collided with person
  evidence:        '#ef4444',
  alpr_sighting:   '#06b6d4', // matches NODE_COLORS.alpr_sighting
};

const VIEW_W = 1000;
const VIEW_H = 600;
const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

// Roles that can save/delete investigations
const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

export default function ConnectionsPage() {
  const { addToast } = useToast();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');

  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link: read params ONCE at mount so they survive later setSearchParams calls.
  // Supports both ?connection_id=<id>&type=<type> and the legacy ?type=<t>&id=<n> forms.
  const pendingConnectionTypeRef = useRef<string | null>(searchParams.get('type'));
  const pendingConnectionIdRef   = useRef<string | null>(
    searchParams.get('connection_id') ?? searchParams.get('id')
  );

  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [seed, setSeed] = useState<Seed | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [edges, setEdges] = useState<SimEdge[]>([]);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [graphDepth, setGraphDepth] = useState(2);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pathFrom, setPathFrom] = useState<{ type: string; id: number; label: string } | null>(null);
  const [pathNodes, setPathNodes] = useState<Set<string>>(new Set());
  const [pathEdges, setPathEdges] = useState<Set<string>>(new Set());
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFlash, setSaveFlash] = useState(false);
  const [loadDropdownOpen, setLoadDropdownOpen] = useState(false);
  const [investigations, setInvestigations] = useState<any[]>([]);
  const [loadingInvestigations, setLoadingInvestigations] = useState(false);
  const [annotations, setAnnotations] = useState<Record<string, string>>({});
  const [editingAnnotationFor, setEditingAnnotationFor] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  // ConfirmDialog state for deleting a saved investigation
  const [confirmDelete, setConfirmDelete] = useState<{ invId: number; name: string } | null>(null);
  const pendingLayoutRef = useRef<Record<string, { x: number; y: number }> | null>(null);
  const debounceRef = useRef<number | null>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState('translate(0,0) scale(1)');
  const [zoomScale, setZoomScale] = useState(1);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timeline, setTimeline] = useState<Array<{ kind: string; id: number; date: string | null; title: string; subtitle: string; status: string }>>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState('');

  // Deep-link: seed graph from URL params on mount, then strip them so refresh doesn't loop.
  useEffect(() => {
    const t     = pendingConnectionTypeRef.current;
    const rawId = pendingConnectionIdRef.current;
    pendingConnectionTypeRef.current = null;
    pendingConnectionIdRef.current   = null;

    if (t && rawId) {
      const idNum = Number(rawId);
      if (Number.isInteger(idNum) && idNum > 0) {
        setSeed({ type: t, id: idNum, label: `${t} #${idNum}` });
      }
    }

    // Strip deep-link params from the URL.
    const next = new URLSearchParams(searchParams);
    let stripped = false;
    for (const key of ['type', 'id', 'connection_id']) {
      if (next.has(key)) { next.delete(key); stripped = true; }
    }
    if (stripped) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts:
  //   N — open Save Investigation modal (canManage + graph loaded, not while typing)
  //   Esc cascade — annotation modal → save modal → load dropdown → path-from mode
  useEffect(() => {
    const isTypingInField = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingAnnotationFor) {
          e.stopPropagation();
          setEditingAnnotationFor(null);
          setAnnotationDraft('');
          return;
        }
        if (saveModalOpen) {
          e.stopPropagation();
          setSaveModalOpen(false);
          setSaveName('');
          setSaveDescription('');
          setSaveError(null);
          return;
        }
        if (loadDropdownOpen) { e.stopPropagation(); setLoadDropdownOpen(false); return; }
        if (pathFrom)         { e.stopPropagation(); setPathFrom(null); setPathNodes(new Set()); setPathEdges(new Set()); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if ((e.key === 'n' || e.key === 'N') && canManage && seed && nodes.length > 0) {
        e.preventDefault();
        setSaveModalOpen(true);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingAnnotationFor, saveModalOpen, loadDropdownOpen, pathFrom, canManage, seed, nodes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchQuery.trim().length < MIN_QUERY_LEN) {
      setResults([]);
      setDropdownOpen(false);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const data = await apiFetch<SearchResult[]>(
          `/connections/search?q=${encodeURIComponent(searchQuery.trim())}`
        );
        setResults(data || []);
        setDropdownOpen(true);
      } catch (err) {
        console.error('Connections search error:', err);
        setResults([]);
        setSearchError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, retryTick]);

  // Graph fetch when seed changes
  useEffect(() => {
    if (!seed) {
      setNodes([]);
      setEdges([]);
      return;
    }
    let cancelled = false;
    setLoadingGraph(true);
    setGraphError(null);
    (async () => {
      try {
        const params = new URLSearchParams({ type: seed.type, id: String(seed.id), depth: String(graphDepth) });
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        const data = await apiFetch<{ nodes: ServerNode[]; edges: ServerEdge[] }>(
          `/connections/graph?${params}`
        );
        if (cancelled) return;
        const isSeedNode = (n: ServerNode) => n.type === seed.type && n.entityId === seed.id;
        const hydrated: SimNode[] = (data?.nodes || []).map(n => {
          const isSeed = isSeedNode(n);
          return {
            ...n,
            x: isSeed ? VIEW_W / 2 : VIEW_W / 2 + (Math.random() - 0.5) * 200,
            y: isSeed ? VIEW_H / 2 : VIEW_H / 2 + (Math.random() - 0.5) * 200,
            fx: isSeed ? VIEW_W / 2 : null,
            fy: isSeed ? VIEW_H / 2 : null,
          };
        });
        const hydratedEdges: SimEdge[] = (data?.edges || []).map(e => ({ ...e }));
        if (pendingLayoutRef.current) {
          const layout = pendingLayoutRef.current;
          pendingLayoutRef.current = null;
          const pinned: SimNode[] = hydrated.map(n => {
            const p = layout[n.id];
            if (p) return { ...n, x: p.x, y: p.y, fx: p.x, fy: p.y };
            return n;
          });
          setNodes(pinned);
        } else {
          setNodes(hydrated);
        }
        setEdges(hydratedEdges);
      } catch (err) {
        console.error('graph fetch err:', err);
        setNodes([]);
        setEdges([]);
        setGraphError(err instanceof Error ? err.message : 'Failed to load graph');
      } finally {
        if (!cancelled) setLoadingGraph(false);
      }
    })();
    return () => { cancelled = true; };
  }, [seed, graphDepth, dateFrom, dateTo, retryTick]);

  // Force simulation
  useEffect(() => {
    if (simRef.current) { simRef.current.stop(); simRef.current = null; }
    if (nodes.length === 0) return;

    // Force parameters scale with node count so dense graphs (depth=3, 100+ nodes)
    // don't collapse into the central blob seen with the previous fixed values.
    const n = nodes.length;
    const chargeStrength = -Math.min(2400, 400 + n * 18);
    const linkDistance = Math.min(220, 110 + Math.sqrt(n) * 8);
    const collidePad = n > 60 ? 14 : n > 25 ? 10 : 8;

    const sim = forceSimulation<SimNode>(nodes)
      .force('charge', forceManyBody().strength(chargeStrength))
      .force('link', forceLink<SimNode, SimEdge>(edges as any).id((d: any) => d.id).distance(linkDistance))
      .force('center', forceCenter(VIEW_W / 2, VIEW_H / 2))
      .force('collide', forceCollide<SimNode>(d => (NODE_RADIUS[d.type] || 16) + collidePad))
      .alpha(1)
      .on('tick', () => {
        setNodes(prev => [...prev]);
      });
    simRef.current = sim;

    return () => { sim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, edges.length]);

  // Initialize d3-zoom once the SVG is mounted AND there are nodes (so sizing is determinate)
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;
    const svg = select(svgRef.current);
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        const t = event.transform;
        setTransform(`translate(${t.x},${t.y}) scale(${t.k})`);
        setZoomScale(t.k);
      });
    svg.call(z as any);
    zoomRef.current = z;
    return () => { svg.on('.zoom', null); };
  }, [nodes.length]);

  // Stable string signature of node membership — only changes when nodes are added/removed,
  // not on every d3 tick (which calls setNodes(prev => [...prev]) and replaces the array ref).
  const nodeKeySig = nodes.map(n => `${n.type}:${n.entityId}`).join(',');

  useEffect(() => {
    if (!timelineOpen || nodeKeySig === '') { setTimeline([]); return; }
    setTimelineLoading(true); setTimelineError('');
    apiFetch<any[]>(`/connections/timeline?nodes=${encodeURIComponent(nodeKeySig)}`)
      .then(r => setTimeline(Array.isArray(r) ? r : []))
      .catch(() => setTimelineError('Failed to load timeline.'))
      .finally(() => setTimelineLoading(false));
  }, [timelineOpen, nodeKeySig]);

  function resetView() {
    if (!svgRef.current || !zoomRef.current) return;
    (select(svgRef.current) as any).transition().duration(250).call((zoomRef.current as any).transform, zoomIdentity);
  }

  function pickSeed(r: SearchResult) {
    setSeed({ id: r.id, type: r.type, label: r.label });
    setDropdownOpen(false);
    setSearchQuery('');
    setResults([]);
    setSelectedNodeId(null);
  }

  const hasOnlySeed = seed && nodes.length === 1;

  const availableTypes = useMemo(
    () => Array.from(new Set(nodes.map(n => n.type))).sort(),
    [nodes]
  );

  const visibleNodes = useMemo(() => {
    if (!seed) return nodes;
    return nodes.filter(n => {
      if (n.type === seed.type && n.entityId === seed.id) return true;
      return !hiddenTypes.has(n.type);
    });
  }, [nodes, hiddenTypes, seed]);

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map(n => n.id)),
    [visibleNodes]
  );

  const visibleEdges = useMemo(() => {
    return edges.filter(e => {
      const src = typeof e.source === 'string' ? e.source : (e.source as SimNode).id;
      const tgt = typeof e.target === 'string' ? e.target : (e.target as SimNode).id;
      return visibleNodeIds.has(src) && visibleNodeIds.has(tgt);
    });
  }, [edges, visibleNodeIds]);

  async function handleNodeClick(n: SimNode) {
    if (pathFrom && !(n.type === pathFrom.type && n.entityId === pathFrom.id)) {
      try {
        const data = await apiFetch<{ path: ServerNode[]; edges: ServerEdge[] }>(
          `/connections/path?fromType=${pathFrom.type}&fromId=${pathFrom.id}&toType=${n.type}&toId=${n.entityId}`
        );
        setPathNodes(new Set(data.path.map(p => p.id)));
        setPathEdges(new Set(data.edges.map(e => `${e.source}|${e.target}`)));
      } catch (err) {
        console.error('Path fetch error:', err);
        addToast('No path found between those nodes (within 6 hops).', 'info');
      }
      setPathFrom(null);
      return;
    }
    setSelectedNodeId(n.id);
  }

  async function handleSave() {
    if (!seed || !saveName.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const pinnedLayout: Record<string, { x: number; y: number }> = {};
      for (const n of nodes) pinnedLayout[n.id] = { x: n.x, y: n.y };
      const payload = {
        name: saveName.trim(),
        description: saveDescription.trim() || undefined,
        seed_nodes: [{ type: seed.type, id: seed.id }],
        pinned_layout: pinnedLayout,
        annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
      };
      await apiFetch('/connections/investigations', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      setSaveModalOpen(false);
      setSaveName('');
      setSaveDescription('');
      setSaveFlash(true);
      window.setTimeout(() => setSaveFlash(false), 2500);
    } catch (err: any) {
      setSaveError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const openLoadDropdown = useCallback(async () => {
    setLoadDropdownOpen(true);
    setLoadingInvestigations(true);
    try {
      const list = await apiFetch<any[]>('/connections/investigations');
      setInvestigations(list || []);
    } catch (err) {
      console.error('load list err:', err);
    } finally {
      setLoadingInvestigations(false);
    }
  }, []);

  async function openInvestigation(id: number) {
    setLoadDropdownOpen(false);
    try {
      const row = await apiFetch<any>(`/connections/investigations/${id}`);
      const seedNodes = JSON.parse(row.seed_nodes || '[]');
      if (!Array.isArray(seedNodes) || seedNodes.length === 0) return;
      const first = seedNodes[0];
      pendingLayoutRef.current = row.pinned_layout ? JSON.parse(row.pinned_layout) : null;
      setAnnotations(row.annotations ? JSON.parse(row.annotations) : {});
      setSeed({ type: first.type, id: first.id, label: row.name || `${first.type} #${first.id}` });
      setSelectedNodeId(null);
    } catch (err) {
      console.error('load investigation err:', err);
      addToast('Failed to load investigation — the saved data may be corrupted. See console for details.', 'error');
    }
  }

  async function handleDeleteInvestigation(id: number) {
    try {
      await apiFetch(`/connections/investigations/${id}`, { method: 'DELETE' });
      setInvestigations(prev => prev.filter(inv => inv.id !== id));
      addToast('Investigation deleted.', 'success');
    } catch (err) {
      console.error('delete investigation err:', err);
      addToast('Failed to delete investigation.', 'error');
    } finally {
      setConfirmDelete(null);
    }
  }

  async function handleExportPng() {
    if (!svgRef.current) return;
    try {
      const dataUrl = await svgElementToPngDataUrl(svgRef.current, { scale: 2, backgroundColor: '#0a0a0a' });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const name = seed ? `connections-${seed.type}-${seed.id}-${ts}.png` : `connections-${ts}.png`;
      downloadDataUrl(dataUrl, name);
    } catch (err) {
      console.error('PNG export failed:', err);
      addToast('PNG export failed — see console for details.', 'error');
    }
  }

  async function handleExportPdf() {
    if (!svgRef.current || !seed) return;
    try {
      const nodeRows = visibleNodes.map(n => ({
        type: n.type,
        label: n.label,
        annotation: annotations[n.id],
      }));

      const blob = await exportGraphToPdf(svgRef.current, nodeRows, {
        seedType: seed.type,
        seedId: seed.id,
        seedLabel: seed.label,
        generatedAt: new Date(),
      });

      const url = URL.createObjectURL(blob);
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const name = `connections-${seed.type}-${seed.id}-${ts}.pdf`;
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('PDF export failed:', err);
      addToast('PDF export failed — see console for details.', 'error');
    }
  }

  function toggleType(t: string) {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  // ── Right-click context menu for graph nodes ──
  const buildNodeMenu = (n: SimNode): ContextMenuItem[] => [
    m.action('Select node', () => setSelectedNodeId(n.id), { icon: <Eye size={12} /> }),
    m.action('Start path from here', () => setPathFrom({ type: n.type, id: n.entityId, label: n.label }), { icon: <Route size={12} /> }),
    m.action(annotations[n.id] ? 'Edit note' : 'Add note', () => { setEditingAnnotationFor(n.id); setAnnotationDraft(annotations[n.id] || ''); }, { icon: <Pencil size={12} /> }),
    m.separator(),
    m.copy('Copy label', n.label),
    m.copyId(n.entityId),
  ];

  const selectedNode = nodes.find(n => n.id === selectedNodeId) ?? null;

  // Map overlay target: the currently-selected graph node if one is picked,
  // otherwise the seed entity itself. GPS breadcrumbs / ALPR sightings are
  // never graphed as nodes (too high-volume — see connections.ts), so this
  // is the only place they're geo-rendered for whatever's in focus.
  const mapNode = selectedNode
    ? { type: selectedNode.type, id: selectedNode.entityId }
    : (seed ? { type: seed.type, id: seed.id } : null);

  return (
    <div className="p-4 space-y-4 h-full flex flex-col">
      <PanelTitleBar title="CONNECTIONS ANALYST" icon={Network}>
        <button
          type="button"
          className="toolbar-btn"
          disabled={nodes.length === 0 && !seed}
          onClick={() => {
            const rows = [
              ...(seed ? [{ type: seed.type, id: seed.id }] : []),
              ...nodes.map((n) => ({ type: n.type, id: n.entityId })),
            ];
            downloadTextFile('connections.csv', connectionSeedsToCsv(rows));
          }}
        >CSV</button>
      </PanelTitleBar>

      {(searchError || graphError) && (
        <div className="p-2 text-xs text-red-400 flex items-center justify-between">
          <span>{searchError || graphError}</span>
          <button type="button" className="toolbar-btn" onClick={() => setRetryTick((n) => n + 1)}>Retry</button>
        </div>
      )}
      <div className="relative">
        <div className="flex items-center gap-2">
          <input id="ff-connectionspage-0"
            ref={searchRef}
            type="text"
            placeholder="Search for a person, vehicle, case, incident... (/)"
            className="flex-1 bg-surface-raised border border-rmpg-700 px-3 py-2 text-sm text-rmpg-200 placeholder-rmpg-500 focus:border-brand-400 focus:outline-none"
            style={{ borderRadius: 2 }}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => { if (results.length) setDropdownOpen(true); }}
            aria-label="Seed search"
          />
          {searching && <Loader2 className="w-4 h-4 animate-spin text-brand-400" />}
          {canManage && (
            <button
              type="button"
              disabled={!seed || nodes.length === 0}
              onClick={() => setSaveModalOpen(true)}
              className="px-3 py-1.5 text-xs bg-surface-raised border border-rmpg-700 text-rmpg-300 hover:text-brand-400 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderRadius: 2 }}
              title="N to save"
            >
              SAVE INVESTIGATION
            </button>
          )}
          <button
            type="button"
            disabled={!seed || nodes.length === 0}
            onClick={handleExportPng}
            className="px-3 py-1.5 text-xs bg-surface-raised border border-rmpg-700 text-rmpg-300 hover:text-brand-400 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderRadius: 2 }}
          >
            EXPORT PNG
          </button>
          <button
            type="button"
            disabled={!seed || nodes.length === 0}
            onClick={handleExportPdf}
            className="px-3 py-1.5 text-xs bg-surface-raised border border-rmpg-700 text-rmpg-300 hover:text-brand-400 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderRadius: 2 }}
          >
            EXPORT PDF
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={openLoadDropdown}
              className="px-3 py-1.5 text-xs bg-surface-raised border border-rmpg-700 text-rmpg-300 hover:text-brand-400"
              style={{ borderRadius: 2 }}
            >
              LOAD INVESTIGATION
            </button>
            {loadDropdownOpen && (
              <div
                role="dialog"
                aria-label="Load investigation"
                className="absolute right-0 z-40 mt-1 w-80 bg-surface-raised border border-rmpg-700"
                style={{ borderRadius: 2 }}
              >
                {loadingInvestigations && (
                  <div className="p-4 flex items-center gap-2 text-xs text-rmpg-400">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                  </div>
                )}
                {!loadingInvestigations && investigations.length === 0 && (
                  <div className="p-4 text-xs text-rmpg-500 text-center">No saved investigations yet.</div>
                )}
                {!loadingInvestigations && investigations.length > 0 && (
                  <ul className="max-h-80 overflow-y-auto">
                    {investigations.map(inv => (
                      <li
                        key={inv.id}
                        className="px-3 py-2 text-sm text-rmpg-200 border-b border-border-subtle flex items-start gap-2"
                      >
                        <span
                          className="flex-1 min-w-0 cursor-pointer hover:text-rmpg-100"
                          onClick={() => openInvestigation(inv.id)}
                        >
                          <div className="font-semibold">{inv.name}</div>
                          {inv.description && <div className="text-xs text-rmpg-500 mt-0.5">{inv.description}</div>}
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete({ invId: inv.id, name: inv.name })}
                            className="shrink-0 text-xs text-rmpg-600 hover:text-red-400 mt-0.5"
                            aria-label={`Delete investigation ${inv.name}`}
                          >
                            DEL
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="p-2 border-t border-rmpg-700 text-right">
                  <button type="button" onClick={() => setLoadDropdownOpen(false)} className="text-xs text-rmpg-400 hover:text-brand-400">Close</button>
                </div>
              </div>
            )}
          </div>
          {saveFlash && (
            <span className="text-xs text-green-400 ml-2">Saved</span>
          )}
        </div>

        {/* Search results dropdown */}
        {dropdownOpen && results.length > 0 && (
          <ul
            role="listbox"
            className="absolute z-10 mt-1 w-full bg-surface-raised border border-rmpg-700 max-h-80 overflow-y-auto"
            style={{ borderRadius: 2 }}
          >
            {results.map(r => (
              <li
                key={`${r.type}-${r.id}`}
                role="option"
                aria-selected={false}
                onClick={() => pickSeed(r)}
                className="px-3 py-2 text-sm text-rmpg-200 cursor-pointer hover:bg-surface-sunken border-b border-border-subtle last:border-b-0"
              >
                <span className="text-brand-400 text-xs uppercase mr-2">{formatEnumValue(r.type)}</span>
                {r.label}
              </li>
            ))}
          </ul>
        )}

        {/* No search results empty state */}
        {dropdownOpen && !searching && searchQuery.trim().length >= MIN_QUERY_LEN && results.length === 0 && (
          <div
            className="absolute z-10 mt-1 w-full bg-surface-raised border border-rmpg-700 px-3 py-3 text-xs text-rmpg-500"
            style={{ borderRadius: 2 }}
          >
            No results for &ldquo;{searchQuery.trim()}&rdquo;
          </div>
        )}
      </div>

      {/* No-seed empty state */}
      {!seed && !loadingGraph && (
        <div className="flex-1 flex items-center justify-center text-rmpg-500 text-sm">
          Search for an entity above to start a connections graph.
        </div>
      )}

      {seed && (
        <div
          data-testid="seed-display"
          className="px-3 py-2 bg-surface-raised border border-brand-400 text-sm text-rmpg-200 flex items-center gap-3"
          style={{ borderRadius: 2 }}
        >
          <span className="text-brand-400 text-xs uppercase font-semibold">{formatEnumValue(seed.type)}</span>
          <span className="font-semibold">{seed.label}</span>
          <span className="text-rmpg-500 text-xs ml-auto">#{seed.id}</span>
          <div className="flex items-center gap-2 border-l border-rmpg-700 pl-3">
            <label htmlFor="depth-slider" className="uppercase font-semibold text-xs text-rmpg-400">Depth</label>
            <input
              id="depth-slider"
              type="range"
              min={1}
              max={3}
              step={1}
              value={graphDepth}
              onChange={e => setGraphDepth(Number(e.target.value))}
              className="accent-brand-400"
              aria-label="Graph depth"
            />
            <span className="text-brand-400 font-mono w-4 text-center text-xs">{graphDepth}</span>
          </div>
          <div className="flex items-center gap-1 border-l border-rmpg-700 pl-3">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="px-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100"
              style={{ borderRadius: 2 }}
              aria-label="Filter from date"
            />
            <span className="text-rmpg-500 text-xs">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="px-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100"
              style={{ borderRadius: 2 }}
              aria-label="Filter to date"
            />
          </div>
          <button
            type="button"
            onClick={() => setTimelineOpen(o => !o)}
            disabled={nodes.length === 0}
            style={{ background: timelineOpen ? '#e879f9' : 'var(--surface-raised)', color: timelineOpen ? '#000' : '#888', borderRadius: 2, padding: '4px 10px', fontSize: 11, fontWeight: 600 }}
            aria-label="Toggle timeline"
          >
            TIMELINE
          </button>
          <button
            type="button"
            onClick={() => { setSeed(null); setAnnotations({}); }}
            className="text-xs text-rmpg-400 hover:text-brand-400"
            aria-label="Clear seed"
          >
            CLEAR
          </button>
        </div>
      )}

      {seed && (
      <div className="flex-1 flex gap-2 min-h-0" style={{ minHeight: 400 }}>
      <div
        data-testid="graph-canvas"
        className="flex-1 bg-surface-sunken border border-rmpg-700 relative overflow-hidden"
        style={{ borderRadius: 2 }}
      >
        {loadingGraph && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-brand-400 gap-2 z-10">
            <Loader2 className="w-4 h-4 animate-spin" /> Building graph...
          </div>
        )}
        {hasOnlySeed && !loadingGraph && (
          <div className="absolute inset-0 flex items-center justify-center text-rmpg-500 text-sm">
            No connections found for {seed.label}.
          </div>
        )}
        {nodes.length > 0 && (
          <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full h-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <g ref={gRef} data-testid="zoom-target" transform={transform}>
            {/* Pass 1 — edges (bottom layer) */}
            {visibleEdges.map((e, i) => {
              const src = typeof e.source === 'string' ? nodes.find(n => n.id === e.source) : (e.source as SimNode);
              const tgt = typeof e.target === 'string' ? nodes.find(n => n.id === e.target) : (e.target as SimNode);
              if (!src || !tgt) return null;
              const srcId = typeof e.source === 'string' ? e.source : (e.source as SimNode).id;
              const tgtId = typeof e.target === 'string' ? e.target : (e.target as SimNode).id;
              const inPath = pathEdges.has(`${srcId}|${tgtId}`) || pathEdges.has(`${tgtId}|${srcId}`);
              const dim = pathNodes.size > 0 && !inPath;
              return (
                <line
                  key={`edge-${i}`}
                  x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                  stroke={inPath ? '#22c55e' : 'var(--text-muted)'}
                  strokeWidth={inPath ? 3 : 1.5}
                  strokeDasharray={inPath ? undefined : '4,3'}
                  opacity={dim ? 0.2 : 1}
                />
              );
            })}
            {/* Pass 2 — node circles (middle layer) */}
            {visibleNodes.map(n => {
              const r = NODE_RADIUS[n.type] || 16;
              const color = NODE_COLORS[n.type] || '#888';
              const isSelected = selectedNodeId === n.id;
              const inPath = pathNodes.has(n.id);
              const dim = pathNodes.size > 0 && !inPath;
              return (
                <g
                  key={n.id}
                  onClick={() => handleNodeClick(n)}
                  onContextMenu={(e) => openMenu(e, buildNodeMenu(n))}
                  onMouseEnter={() => setHoveredNodeId(n.id)}
                  onMouseLeave={() => setHoveredNodeId(prev => (prev === n.id ? null : prev))}
                  data-has-annotation={annotations[n.id] ? 'true' : 'false'}
                  style={{ cursor: 'pointer', opacity: dim ? 0.25 : 1 }}
                >
                  {inPath && (
                    <circle cx={n.x} cy={n.y} r={r + 7} fill="none" stroke="#22c55e" strokeWidth={3} opacity={0.8} />
                  )}
                  {isSelected && !inPath && (
                    <circle cx={n.x} cy={n.y} r={r + 5} fill="none" stroke={color} strokeWidth={2} opacity={0.5} />
                  )}
                  <circle
                    cx={n.x} cy={n.y} r={r}
                    fill="var(--surface-sunken)" stroke={inPath ? '#22c55e' : color} strokeWidth={inPath ? 3 : 2}
                  />
                  {n.type === 'intel_report' && (() => {
                    const THREAT_RING: Record<string, string> = { critical: '#ef4444', high: '#f59e0b', medium: '#d4a017', low: '#64748b' };
                    const ring = THREAT_RING[(n.metadata?.threat_level as string) || 'low'] || '#64748b';
                    const rr = (NODE_RADIUS[n.type] || 20);
                    return (
                      <>
                        <circle cx={n.x} cy={n.y} r={rr + 3} fill="none" stroke={ring} strokeWidth={2.5} />
                        {n.metadata?.grade ? (
                          <>
                            <rect x={(n.x ?? 0) - 12} y={(n.y ?? 0) - rr - 16} width={24} height={13} rx={2} fill="#e879f9" />
                            <text x={n.x} y={(n.y ?? 0) - rr - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--surface-sunken)">
                              {String(n.metadata.grade)}
                            </text>
                          </>
                        ) : null}
                      </>
                    );
                  })()}
                  <text
                    x={n.x} y={n.y - 1} textAnchor="middle" dominantBaseline="middle"
                    fontSize={r > 20 ? 11 : 9} fill={color} fontFamily="monospace" fontWeight="bold"
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.type[0].toUpperCase()}
                  </text>
                  {annotations[n.id] && (
                    <text
                      x={n.x + r - 4} y={n.y - r + 8}
                      fontSize={10} fill="var(--brand-gold)" fontFamily="monospace" fontWeight="bold"
                      style={{ pointerEvents: 'none' }}
                    >
                      ✎
                    </text>
                  )}
                </g>
              );
            })}
            {/* Pass 3 — labels (top layer, with backdrop rect for legibility against neighbors) */}
            {visibleNodes.map(n => {
              const r = NODE_RADIUS[n.type] || 16;
              const isSeed = !!seed && n.type === seed.type && n.entityId === seed.id;
              const isSelected = selectedNodeId === n.id;
              const isHovered = hoveredNodeId === n.id;
              const inPath = pathNodes.has(n.id);
              const hasAnnotation = !!annotations[n.id];
              const dim = pathNodes.size > 0 && !inPath;

              // Density-aware visibility (strategy "D"): always show in small graphs
              // and when zoomed in; in dense+zoomed-out graphs, only show "important" labels.
              const dense = visibleNodes.length > 25;
              const zoomedIn = zoomScale >= 1.5;
              const important = isSeed || isSelected || isHovered || inPath || hasAnnotation;
              const showLabel = !dense || zoomedIn || important;
              if (!showLabel) return null;

              const truncated = n.label.length > 18 ? n.label.slice(0, 16) + '…' : n.label;
              // Approximate text width for the backdrop rect (monospace ~5.4px/char @ 9px).
              const textW = truncated.length * 5.4 + 6;
              const textH = 11;
              const labelY = n.y + r + 11;
              return (
                // Clicking a label is the same as clicking its node — better UX,
                // and keeps DOM-traversal-based tests working (closest('g') from
                // the label text reaches a clickable group).
                <g
                  key={`label-${n.id}`}
                  onClick={() => handleNodeClick(n)}
                  onContextMenu={(e) => openMenu(e, buildNodeMenu(n))}
                  onMouseEnter={() => setHoveredNodeId(n.id)}
                  onMouseLeave={() => setHoveredNodeId(prev => (prev === n.id ? null : prev))}
                  style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }}
                >
                  <rect
                    x={n.x - textW / 2}
                    y={labelY - textH + 1}
                    width={textW}
                    height={textH + 2}
                    fill="var(--surface-sunken)"
                    fillOpacity={0.82}
                    stroke={important ? 'var(--brand-gold)' : 'none'}
                    strokeWidth={important ? 0.5 : 0}
                  />
                  <text
                    x={n.x} y={labelY} textAnchor="middle"
                    fontSize={9}
                    fill={isSeed ? 'var(--brand-gold)' : important ? '#fff' : '#ccc'}
                    fontWeight={important ? 'bold' : 'normal'}
                    fontFamily="monospace"
                  >
                    {truncated}
                  </text>
                </g>
              );
            })}
            </g>
          </svg>
          <button
            type="button"
            onClick={resetView}
            className="absolute top-2 right-2 bg-surface-raised border border-rmpg-700 px-2 py-1 text-xs text-rmpg-300 hover:text-brand-400"
            style={{ borderRadius: 2 }}
            aria-label="Reset view"
          >
            RESET VIEW
          </button>
          {pathNodes.size > 0 && !pathFrom && (
            <button
              type="button"
              onClick={() => { setPathNodes(new Set()); setPathEdges(new Set()); }}
              className="absolute top-2 right-28 bg-surface-raised border border-rmpg-700 px-2 py-1 text-xs text-rmpg-300 hover:text-brand-400"
              style={{ borderRadius: 2 }}
            >
              CLEAR PATH
            </button>
          )}
          {selectedNodeId && !pathFrom && (
            <div
              className="absolute bottom-2 left-2 bg-surface-raised border border-rmpg-700 px-2 py-1 text-xs text-rmpg-300 z-20 max-w-md"
              style={{ borderRadius: 2 }}
            >
              <div className="flex items-center gap-2 flex-wrap">
              <span>Selected: {selectedNode?.label}</span>
              <button
                type="button"
                onClick={() => {
                  const sel = nodes.find(n => n.id === selectedNodeId);
                  if (sel) setPathFrom({ type: sel.type, id: sel.entityId, label: sel.label });
                }}
                className="text-brand-400 hover:underline uppercase font-semibold"
              >
                Start Path
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingAnnotationFor(selectedNodeId);
                  setAnnotationDraft(annotations[selectedNodeId] || '');
                }}
                className="text-brand-400 hover:underline uppercase font-semibold"
              >
                {annotations[selectedNodeId] ? 'Edit note' : 'Add note'}
              </button>
              {annotations[selectedNodeId] && (
                <span className="text-rmpg-400 italic border-l border-rmpg-700 pl-2 ml-1">
                  {annotations[selectedNodeId]}
                </span>
              )}
              </div>
              {selectedNode?.type === 'intel_report' && (
                <div className="mt-2 space-y-1 text-[11px]">
                  <div className="text-rmpg-500">
                    Grade {String(selectedNode.metadata?.grade || '—')} · Threat {String(selectedNode.metadata?.threat_level || '—')} · Handling {String(selectedNode.metadata?.handling_code || '—')}
                  </div>
                  <Link to={`/intel/reports/${selectedNode.entityId}`} style={{ color: '#e879f9' }}>Open intelligence product →</Link>
                </div>
              )}
            </div>
          )}
          {pathFrom && (
            <div
              className="absolute top-2 left-2 right-32 bg-surface-raised border border-brand-400 px-3 py-2 flex items-center justify-between text-xs text-brand-400 z-20"
              style={{ borderRadius: 2 }}
            >
              <span>Click a second node to find the path from <strong>{pathFrom.label}</strong></span>
              <button
                type="button"
                onClick={() => { setPathFrom(null); setPathNodes(new Set()); setPathEdges(new Set()); }}
                className="text-rmpg-300 hover:text-brand-400 uppercase font-semibold"
                aria-label="Cancel path"
              >
                Cancel Path
              </button>
            </div>
          )}
          </>
        )}
      </div>
      {availableTypes.length > 0 && (
        <div
          className="w-40 bg-surface-raised border border-rmpg-700 p-2 space-y-1 overflow-y-auto"
          style={{ borderRadius: 2 }}
        >
          <div className="text-brand-400 text-xs uppercase font-semibold mb-2">Filter by Type</div>
          {availableTypes.map(t => (
            <label
              key={t}
              className="flex items-center gap-2 text-xs text-rmpg-300 cursor-pointer hover:text-brand-400"
            >
              <input id="ff-connectionspage-1"
                type="checkbox"
                checked={!hiddenTypes.has(t)}
                onChange={() => toggleType(t)}
                aria-label={`Show ${t}`}
                className="accent-brand-400"
              />
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: NODE_COLORS[t] || '#888' }}
              />
              <span className="uppercase">{t}</span>
            </label>
          ))}
        </div>
      )}
      {timelineOpen && (
        <div style={{ width: 320, background: 'var(--surface-overlay)', borderLeft: '1px solid var(--border-subtle)', overflowY: 'auto', padding: 8, flexShrink: 0, maxHeight: '100%' }}>
          <div className="text-[9px] font-semibold mb-2" style={{ color: '#e879f9' }}>TIMELINE — {nodes.length} NODES</div>
          {timelineError && <div style={{ color: 'var(--sev-critical)', fontSize: 11 }}>{timelineError}</div>}
          {timelineLoading && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Loading…</div>}
          {!timelineLoading && !timelineError && timeline.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No dated events in this graph.</div>
          )}
          {timeline.map((ev, i) => {
            return (
              <div key={`${ev.kind}-${ev.id}-${i}`} className="py-[3px]" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center gap-2 text-[10px]">
                  <span style={{ color: TIMELINE_KIND_COLOR[ev.kind] || '#888', fontWeight: 700 }}>{ev.kind.toUpperCase()}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{ev.date ? ev.date.slice(0, 10) : '—'}</span>
                </div>
                <div className="text-[11px]" style={{ color: 'var(--text-primary)' }}>{ev.title}</div>
                {ev.subtitle && <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{ev.subtitle}</div>}
              </div>
            );
          })}
        </div>
      )}
      </div>
      )}

      {seed && mapNode && (
        <div>
          <div className="text-brand-400 text-xs uppercase font-semibold mb-1">
            Map — {selectedNode ? selectedNode.label : seed.label}
          </div>
          <ConnectionsMapPanel
            key={`${mapNode.type}-${mapNode.id}`}
            nodeType={mapNode.type}
            nodeEntityId={mapNode.id}
          />
        </div>
      )}

      {/* Annotation edit modal */}
      {editingAnnotationFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div role="dialog" className="w-96 bg-surface-raised border border-rmpg-700 p-4 space-y-3" style={{ borderRadius: 2 }}>
            <h2 className="text-brand-400 text-sm uppercase font-semibold">
              Note for {nodes.find(n => n.id === editingAnnotationFor)?.label}
            </h2>
            <RichTextArea
              aria-label={`Note for ${nodes.find(n => n.id === editingAnnotationFor)?.label}`}
              className="w-full bg-surface-sunken border border-rmpg-700 px-2 py-1.5 text-sm text-rmpg-200 focus:border-brand-400 focus:outline-none h-28"
              style={{ borderRadius: 2 }}
              value={annotationDraft}
              onChange={e => setAnnotationDraft(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setEditingAnnotationFor(null); setAnnotationDraft(''); }}
                className="px-3 py-1.5 text-xs text-rmpg-300 hover:text-brand-400"
              >
                Cancel
              </button>
              {annotations[editingAnnotationFor] && (
                <button
                  type="button"
                  onClick={() => {
                    setAnnotations(prev => {
                      const next = { ...prev };
                      delete next[editingAnnotationFor!];
                      return next;
                    });
                    setEditingAnnotationFor(null);
                    setAnnotationDraft('');
                  }}
                  className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300"
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const k = editingAnnotationFor!;
                  setAnnotations(prev => ({ ...prev, [k]: annotationDraft }));
                  setEditingAnnotationFor(null);
                  setAnnotationDraft('');
                }}
                className="px-3 py-1.5 text-xs bg-brand-700 text-rmpg-100 font-semibold hover:bg-brand-600"
                style={{ borderRadius: 2 }}
              >
                Save note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save investigation modal */}
      {saveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div
            role="dialog"
            aria-label="Save investigation"
            className="w-96 bg-surface-raised border border-rmpg-700 p-4 space-y-3"
            style={{ borderRadius: 2 }}
          >
            <h2 className="text-brand-400 text-sm uppercase font-semibold">Save Investigation</h2>

            <label className="block text-xs text-rmpg-300">
              Name
              <input id="ff-connectionspage-2"
                type="text"
                className="mt-1 w-full bg-surface-sunken border border-rmpg-700 px-2 py-1.5 text-sm text-rmpg-200 focus:border-brand-400 focus:outline-none"
                style={{ borderRadius: 2 }}
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                autoFocus
              />
            </label>

            <label className="block text-xs text-rmpg-300">
              Description
              <RichTextArea
                className="mt-1 w-full bg-surface-sunken border border-rmpg-700 px-2 py-1.5 text-sm text-rmpg-200 focus:border-brand-400 focus:outline-none h-20"
                style={{ borderRadius: 2 }}
                value={saveDescription}
                onChange={e => setSaveDescription(e.target.value)}
              />
            </label>

            {saveError && <div className="text-xs text-red-400">{saveError}</div>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSaveModalOpen(false);
                  setSaveName('');
                  setSaveDescription('');
                  setSaveError(null);
                }}
                className="px-3 py-1.5 text-xs text-rmpg-300 hover:text-brand-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!saveName.trim() || saving}
                className="px-3 py-1.5 text-xs bg-brand-700 text-rmpg-100 font-semibold hover:bg-brand-600 disabled:opacity-40"
                style={{ borderRadius: 2 }}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete investigation confirm dialog */}
      <ConfirmDialog
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDeleteInvestigation(confirmDelete.invId)}
        title="Delete Investigation"
        message="Permanently delete this saved investigation? This cannot be undone."
        details={confirmDelete ? <span>{confirmDelete.name}</span> : undefined}
        confirmLabel="Delete"
        confirmVariant="danger"
      />
    </div>
  );
}
