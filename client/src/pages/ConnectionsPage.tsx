import { useState, useEffect, useRef } from 'react';
import { Network, Loader2 } from 'lucide-react';
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, Simulation } from 'd3-force';
import { zoom, zoomIdentity, ZoomBehavior } from 'd3-zoom';
import { select } from 'd3-selection';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';

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
          `/connections/graph?type=${seed.type}&id=${seed.id}&depth=2`
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
        setNodes(hydrated);
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
  }, [seed]);

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
          <button
            type="button"
            onClick={() => setSeed(null)}
            className="text-xs text-gray-400 hover:text-[#d4a017]"
            aria-label="Clear seed"
          >
            CLEAR
          </button>
        </div>
      )}

      <div
        data-testid="graph-canvas"
        className="flex-1 bg-surface-sunken border border-[#222222] relative overflow-hidden"
        style={{ borderRadius: 2, minHeight: 400 }}
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
            {edges.map((e, i) => {
              const src = typeof e.source === 'string' ? nodes.find(n => n.id === e.source) : (e.source as SimNode);
              const tgt = typeof e.target === 'string' ? nodes.find(n => n.id === e.target) : (e.target as SimNode);
              if (!src || !tgt) return null;
              return (
                <g key={`edge-${i}`}>
                  <line
                    x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                    stroke="#333" strokeWidth={1.5} strokeDasharray="4,3"
                  />
                </g>
              );
            })}
            {nodes.map(n => {
              const r = NODE_RADIUS[n.type] || 16;
              const color = NODE_COLORS[n.type] || '#888';
              const isSelected = selectedNodeId === n.id;
              return (
                <g
                  key={n.id}
                  onClick={() => setSelectedNodeId(n.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {isSelected && (
                    <circle cx={n.x} cy={n.y} r={r + 5} fill="none" stroke={color} strokeWidth={2} opacity={0.5} />
                  )}
                  <circle
                    cx={n.x} cy={n.y} r={r}
                    fill="#0a0a0a" stroke={color} strokeWidth={2}
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
          </>
        )}
      </div>
    </div>
  );
}
