import { useState, useEffect, useRef, useMemo } from 'react';
import { Network, Loader2 } from 'lucide-react';
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, Simulation } from 'd3-force';
import { zoom, zoomIdentity, ZoomBehavior } from 'd3-zoom';
import { select } from 'd3-selection';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { svgElementToPngDataUrl, downloadDataUrl } from '../utils/graphToPng';
import { exportGraphToPdf } from '../utils/graphToPdf';

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

const NODE_COLORS: Record<string, string> = {
  person: '#d4a017',
  vehicle: '#10b981',
  property: '#8b5cf6',
  evidence: '#ef4444',
  case: '#3b82f6',
  incident: '#f59e0b',
  warrant: '#dc2626',
  citation: '#fbbf24',
  arrest: '#ef4444',
  field_interview: '#64748b',
  trespass_order: '#a855f7',
  serve_job: '#14b8a6',
};

const NODE_RADIUS: Record<string, number> = {
  person: 28, vehicle: 18, property: 18, evidence: 16,
  case: 18, incident: 20, warrant: 18, citation: 16,
  arrest: 18, field_interview: 14, trespass_order: 16, serve_job: 16,
};

const VIEW_W = 1000;
const VIEW_H = 600;
const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

export default function ConnectionsPage() {
  const [searchQuery, setSearchQuery] = useState('');
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
  const pendingLayoutRef = useRef<Record<string, { x: number; y: number }> | null>(null);
  const debounceRef = useRef<number | null>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState('translate(0,0) scale(1)');

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchQuery.trim().length < MIN_QUERY_LEN) {
      setResults([]);
      setDropdownOpen(false);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const data = await apiFetch<SearchResult[]>(
          `/connections/search?q=${encodeURIComponent(searchQuery.trim())}`
        );
        setResults(data || []);
        setDropdownOpen(true);
      } catch (err) {
        console.error('Connections search error:', err);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // Graph fetch when seed changes
  useEffect(() => {
    if (!seed) {
      setNodes([]);
      setEdges([]);
      return;
    }
    let cancelled = false;
    setLoadingGraph(true);
    (async () => {
      try {
        const data = await apiFetch<{ nodes: ServerNode[]; edges: ServerEdge[] }>(
          `/connections/graph?type=${seed.type}&id=${seed.id}&depth=${graphDepth}`
        );
        if (cancelled) return;
        const isSeedNode = (n: ServerNode) => n.type === seed.type && n.entityId === seed.id;
        const hydrated: SimNode[] = data.nodes.map(n => {
          const isSeed = isSeedNode(n);
          return {
            ...n,
            x: isSeed ? VIEW_W / 2 : VIEW_W / 2 + (Math.random() - 0.5) * 200,
            y: isSeed ? VIEW_H / 2 : VIEW_H / 2 + (Math.random() - 0.5) * 200,
            fx: isSeed ? VIEW_W / 2 : null,
            fy: isSeed ? VIEW_H / 2 : null,
          };
        });
        const hydratedEdges: SimEdge[] = data.edges.map(e => ({ ...e }));
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
      } finally {
        if (!cancelled) setLoadingGraph(false);
      }
    })();
    return () => { cancelled = true; };
  }, [seed, graphDepth]);

  // Force simulation
  useEffect(() => {
    if (simRef.current) { simRef.current.stop(); simRef.current = null; }
    if (nodes.length === 0) return;

    const sim = forceSimulation<SimNode>(nodes)
      .force('charge', forceManyBody().strength(-600))
      .force('link', forceLink<SimNode, SimEdge>(edges as any).id((d: any) => d.id).distance(130))
      .force('center', forceCenter(VIEW_W / 2, VIEW_H / 2))
      .force('collide', forceCollide<SimNode>(d => (NODE_RADIUS[d.type] || 16) + 8))
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
      });
    svg.call(z as any);
    zoomRef.current = z;
    return () => { svg.on('.zoom', null); };
  }, [nodes.length]);

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
        alert('No path found between those nodes (within 6 hops).');
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

  async function openLoadDropdown() {
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
  }

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
      alert('PNG export failed — see console for details.');
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
      alert('PDF export failed — see console for details.');
    }
  }

  function toggleType(t: string) {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  return (
    <div className="p-4 space-y-4 h-full flex flex-col">
      <PanelTitleBar title="CONNECTIONS ANALYST" icon={Network} />

      <div className="relative">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search for a person, vehicle, case, incident..."
            className="flex-1 bg-surface-raised border border-[#222222] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-[#d4a017] focus:outline-none"
            style={{ borderRadius: 2 }}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => { if (results.length) setDropdownOpen(true); }}
            aria-label="Seed search"
          />
          {searching && <Loader2 className="w-4 h-4 animate-spin text-[#d4a017]" />}
          <button
            type="button"
            disabled={!seed || nodes.length === 0}
            onClick={() => setSaveModalOpen(true)}
            className="px-3 py-1.5 text-xs bg-surface-raised border border-[#222222] text-gray-300 hover:text-[#d4a017] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderRadius: 2 }}
          >
            SAVE INVESTIGATION
          </button>
          <button
            type="button"
            disabled={!seed || nodes.length === 0}
            onClick={handleExportPng}
            className="px-3 py-1.5 text-xs bg-surface-raised border border-[#222222] text-gray-300 hover:text-[#d4a017] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderRadius: 2 }}
          >
            EXPORT PNG
          </button>
          <button
            type="button"
            disabled={!seed || nodes.length === 0}
            onClick={handleExportPdf}
            className="px-3 py-1.5 text-xs bg-surface-raised border border-[#222222] text-gray-300 hover:text-[#d4a017] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderRadius: 2 }}
          >
            EXPORT PDF
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={openLoadDropdown}
              className="px-3 py-1.5 text-xs bg-surface-raised border border-[#222222] text-gray-300 hover:text-[#d4a017]"
              style={{ borderRadius: 2 }}
            >
              LOAD INVESTIGATION
            </button>
            {loadDropdownOpen && (
              <div
                role="dialog"
                aria-label="Load investigation"
                className="absolute right-0 z-40 mt-1 w-80 bg-surface-raised border border-[#222222]"
                style={{ borderRadius: 2 }}
              >
                {loadingInvestigations && <div className="p-3 text-xs text-gray-400">Loading...</div>}
                {!loadingInvestigations && investigations.length === 0 && (
                  <div className="p-3 text-xs text-gray-500">No saved investigations yet.</div>
                )}
                {!loadingInvestigations && investigations.length > 0 && (
                  <ul className="max-h-80 overflow-y-auto">
                    {investigations.map(inv => (
                      <li
                        key={inv.id}
                        onClick={() => openInvestigation(inv.id)}
                        className="px-3 py-2 text-sm text-gray-200 cursor-pointer hover:bg-surface-sunken border-b border-[#1a1a1a]"
                      >
                        <div className="font-semibold">{inv.name}</div>
                        {inv.description && <div className="text-xs text-gray-500 mt-0.5">{inv.description}</div>}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="p-2 border-t border-[#222222] text-right">
                  <button type="button" onClick={() => setLoadDropdownOpen(false)} className="text-xs text-gray-400 hover:text-[#d4a017]">Close</button>
                </div>
              </div>
            )}
          </div>
          {saveFlash && (
            <span className="text-xs text-green-400 ml-2">Saved</span>
          )}
        </div>

        {dropdownOpen && results.length > 0 && (
          <ul
            role="listbox"
            className="absolute z-10 mt-1 w-full bg-surface-raised border border-[#222222] max-h-80 overflow-y-auto"
            style={{ borderRadius: 2 }}
          >
            {results.map(r => (
              <li
                key={`${r.type}-${r.id}`}
                role="option"
                aria-selected={false}
                onClick={() => pickSeed(r)}
                className="px-3 py-2 text-sm text-gray-200 cursor-pointer hover:bg-surface-sunken border-b border-[#1a1a1a] last:border-b-0"
              >
                <span className="text-[#d4a017] text-xs uppercase mr-2">{r.type}</span>
                {r.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {seed && (
        <div
          data-testid="seed-display"
          className="px-3 py-2 bg-surface-raised border border-[#d4a017] text-sm text-gray-200 flex items-center gap-3"
          style={{ borderRadius: 2 }}
        >
          <span className="text-[#d4a017] text-xs uppercase font-semibold">{seed.type}</span>
          <span className="font-semibold">{seed.label}</span>
          <span className="text-gray-500 text-xs ml-auto">#{seed.id}</span>
          <div className="flex items-center gap-2 border-l border-[#222222] pl-3">
            <label htmlFor="depth-slider" className="uppercase font-semibold text-xs text-gray-400">Depth</label>
            <input
              id="depth-slider"
              type="range"
              min={1}
              max={3}
              step={1}
              value={graphDepth}
              onChange={e => setGraphDepth(Number(e.target.value))}
              className="accent-[#d4a017]"
              aria-label="Graph depth"
            />
            <span className="text-[#d4a017] font-mono w-4 text-center text-xs">{graphDepth}</span>
          </div>
          <button
            type="button"
            onClick={() => { setSeed(null); setAnnotations({}); }}
            className="text-xs text-gray-400 hover:text-[#d4a017]"
            aria-label="Clear seed"
          >
            CLEAR
          </button>
        </div>
      )}

      <div className="flex-1 flex gap-2 min-h-0" style={{ minHeight: 400 }}>
      <div
        data-testid="graph-canvas"
        className="flex-1 bg-surface-sunken border border-[#222222] relative overflow-hidden"
        style={{ borderRadius: 2 }}
      >
        {loadingGraph && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[#d4a017] gap-2 z-10">
            <Loader2 className="w-4 h-4 animate-spin" /> Building graph...
          </div>
        )}
        {!seed && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
            Seed a graph by searching above.
          </div>
        )}
        {seed && hasOnlySeed && !loadingGraph && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
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
            {visibleEdges.map((e, i) => {
              const src = typeof e.source === 'string' ? nodes.find(n => n.id === e.source) : (e.source as SimNode);
              const tgt = typeof e.target === 'string' ? nodes.find(n => n.id === e.target) : (e.target as SimNode);
              if (!src || !tgt) return null;
              const srcId = typeof e.source === 'string' ? e.source : (e.source as SimNode).id;
              const tgtId = typeof e.target === 'string' ? e.target : (e.target as SimNode).id;
              const inPath = pathEdges.has(`${srcId}|${tgtId}`) || pathEdges.has(`${tgtId}|${srcId}`);
              const dim = pathNodes.size > 0 && !inPath;
              return (
                <g key={`edge-${i}`}>
                  <line
                    x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                    stroke={inPath ? '#22c55e' : '#333'}
                    strokeWidth={inPath ? 3 : 1.5}
                    strokeDasharray={inPath ? undefined : '4,3'}
                    opacity={dim ? 0.2 : 1}
                  />
                </g>
              );
            })}
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
                    fill="#0a0a0a" stroke={inPath ? '#22c55e' : color} strokeWidth={inPath ? 3 : 2}
                  />
                  <text
                    x={n.x} y={n.y - 1} textAnchor="middle" dominantBaseline="middle"
                    fontSize={r > 20 ? 11 : 9} fill={color} fontFamily="monospace" fontWeight="bold"
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.type[0].toUpperCase()}
                  </text>
                  <text
                    x={n.x} y={n.y + r + 11} textAnchor="middle"
                    fontSize={9} fill="#ccc" fontFamily="monospace"
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.label.length > 22 ? n.label.slice(0, 20) + '…' : n.label}
                  </text>
                  {annotations[n.id] && (
                    <text
                      x={n.x + r - 4} y={n.y - r + 8}
                      fontSize={10} fill="#d4a017" fontFamily="monospace" fontWeight="bold"
                      style={{ pointerEvents: 'none' }}
                    >
                      ✎
                    </text>
                  )}
                </g>
              );
            })}
            </g>
          </svg>
          <button
            type="button"
            onClick={resetView}
            className="absolute top-2 right-2 bg-surface-raised border border-[#222222] px-2 py-1 text-xs text-gray-300 hover:text-[#d4a017]"
            style={{ borderRadius: 2 }}
            aria-label="Reset view"
          >
            RESET VIEW
          </button>
          {pathNodes.size > 0 && !pathFrom && (
            <button
              type="button"
              onClick={() => { setPathNodes(new Set()); setPathEdges(new Set()); }}
              className="absolute top-2 right-28 bg-surface-raised border border-[#222222] px-2 py-1 text-xs text-gray-300 hover:text-[#d4a017]"
              style={{ borderRadius: 2 }}
            >
              CLEAR PATH
            </button>
          )}
          {selectedNodeId && !pathFrom && (
            <div
              className="absolute bottom-2 left-2 bg-surface-raised border border-[#222222] px-2 py-1 flex items-center gap-2 text-xs text-gray-300 z-20 max-w-md"
              style={{ borderRadius: 2 }}
            >
              <span>Selected: {nodes.find(n => n.id === selectedNodeId)?.label}</span>
              <button
                type="button"
                onClick={() => {
                  const sel = nodes.find(n => n.id === selectedNodeId);
                  if (sel) setPathFrom({ type: sel.type, id: sel.entityId, label: sel.label });
                }}
                className="text-[#d4a017] hover:underline uppercase font-semibold"
              >
                Start Path
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingAnnotationFor(selectedNodeId);
                  setAnnotationDraft(annotations[selectedNodeId] || '');
                }}
                className="text-[#d4a017] hover:underline uppercase font-semibold"
              >
                {annotations[selectedNodeId] ? 'Edit note' : 'Add note'}
              </button>
              {annotations[selectedNodeId] && (
                <span className="text-gray-400 italic border-l border-[#222222] pl-2 ml-1">
                  {annotations[selectedNodeId]}
                </span>
              )}
            </div>
          )}
          {pathFrom && (
            <div
              className="absolute top-2 left-2 right-32 bg-[#1a1a1a] border border-[#d4a017] px-3 py-2 flex items-center justify-between text-xs text-[#d4a017] z-20"
              style={{ borderRadius: 2 }}
            >
              <span>Click a second node to find the path from <strong>{pathFrom.label}</strong></span>
              <button
                type="button"
                onClick={() => { setPathFrom(null); setPathNodes(new Set()); setPathEdges(new Set()); }}
                className="text-gray-300 hover:text-[#d4a017] uppercase font-semibold"
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
          className="w-40 bg-surface-raised border border-[#222222] p-2 space-y-1 overflow-y-auto"
          style={{ borderRadius: 2 }}
        >
          <div className="text-[#d4a017] text-xs uppercase font-semibold mb-2">Filter by Type</div>
          {availableTypes.map(t => (
            <label
              key={t}
              className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-[#d4a017]"
            >
              <input
                type="checkbox"
                checked={!hiddenTypes.has(t)}
                onChange={() => toggleType(t)}
                aria-label={`Show ${t}`}
                className="accent-[#d4a017]"
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
      </div>

      {editingAnnotationFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div role="dialog" className="w-96 bg-surface-raised border border-[#222222] p-4 space-y-3" style={{ borderRadius: 2 }}>
            <h2 className="text-[#d4a017] text-sm uppercase font-semibold">
              Note for {nodes.find(n => n.id === editingAnnotationFor)?.label}
            </h2>
            <textarea
              aria-label={`Note for ${nodes.find(n => n.id === editingAnnotationFor)?.label}`}
              className="w-full bg-surface-sunken border border-[#222222] px-2 py-1.5 text-sm text-gray-200 focus:border-[#d4a017] focus:outline-none h-28"
              style={{ borderRadius: 2 }}
              value={annotationDraft}
              onChange={e => setAnnotationDraft(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setEditingAnnotationFor(null); setAnnotationDraft(''); }}
                className="px-3 py-1.5 text-xs text-gray-300 hover:text-[#d4a017]"
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
                className="px-3 py-1.5 text-xs bg-[#d4a017] text-black font-semibold hover:bg-[#e0b030]"
                style={{ borderRadius: 2 }}
              >
                Save note
              </button>
            </div>
          </div>
        </div>
      )}

      {saveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div
            role="dialog"
            aria-label="Save investigation"
            className="w-96 bg-surface-raised border border-[#222222] p-4 space-y-3"
            style={{ borderRadius: 2 }}
          >
            <h2 className="text-[#d4a017] text-sm uppercase font-semibold">Save Investigation</h2>

            <label className="block text-xs text-gray-300">
              Name
              <input
                type="text"
                className="mt-1 w-full bg-surface-sunken border border-[#222222] px-2 py-1.5 text-sm text-gray-200 focus:border-[#d4a017] focus:outline-none"
                style={{ borderRadius: 2 }}
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                autoFocus
              />
            </label>

            <label className="block text-xs text-gray-300">
              Description
              <textarea
                className="mt-1 w-full bg-surface-sunken border border-[#222222] px-2 py-1.5 text-sm text-gray-200 focus:border-[#d4a017] focus:outline-none h-20"
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
                className="px-3 py-1.5 text-xs text-gray-300 hover:text-[#d4a017]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!saveName.trim() || saving}
                className="px-3 py-1.5 text-xs bg-[#d4a017] text-black font-semibold hover:bg-[#e0b030] disabled:opacity-40"
                style={{ borderRadius: 2 }}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
