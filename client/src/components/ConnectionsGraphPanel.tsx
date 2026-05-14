import { useState, useEffect, useRef, useCallback } from 'react';
import { Network, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import CollapsibleSection from './CollapsibleSection';

// ── Types ────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  type: 'person' | 'vehicle' | 'property' | 'evidence' | 'case' | 'incident'
      | 'warrant' | 'citation' | 'arrest' | 'field_interview' | 'trespass_order' | 'serve_job';
  label: string;
  subLabel?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

// ── Color map per node type ──────────────────────────────────

const NODE_COLORS: Record<string, string> = {
  person: '#d4a017',
  incident: '#f59e0b',
  vehicle: '#10b981',
  property: '#8b5cf6',
  evidence: '#ef4444',
  case: '#3b82f6',
  warrant: '#dc2626',
  citation: '#fbbf24',
  arrest: '#ef4444',
  field_interview: '#64748b',
  trespass_order: '#a855f7',
  serve_job: '#14b8a6',
};

const NODE_RADIUS: Record<string, number> = {
  person: 28,
  incident: 18,
  vehicle: 16,
  property: 16,
  evidence: 16,
  case: 16,
  warrant: 18,
  citation: 16,
  arrest: 18,
  field_interview: 14,
  trespass_order: 16,
  serve_job: 16,
};

// ── Force simulation (simple spring + repulsion) ─────────────

function simulate(nodes: GraphNode[], edges: GraphEdge[], iterations = 120) {
  const alpha = 0.3;
  const repulsion = 3000;
  const springLen = 100;
  const springK = 0.05;
  const damping = 0.85;

  for (let iter = 0; iter < iterations; iter++) {
    const decay = 1 - iter / iterations;
    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (repulsion * decay) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!nodes[i].pinned) { nodes[i].vx -= fx; nodes[i].vy -= fy; }
        if (!nodes[j].pinned) { nodes[j].vx += fx; nodes[j].vy += fy; }
      }
    }
    // Spring attraction along edges
    for (const e of edges) {
      const src = nodes.find(n => n.id === e.source);
      const tgt = nodes.find(n => n.id === e.target);
      if (!src || !tgt) continue;
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (dist - springLen) * springK * decay;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!src.pinned) { src.vx += fx; src.vy += fy; }
      if (!tgt.pinned) { tgt.vx -= fx; tgt.vy -= fy; }
    }
    // Apply velocities
    for (const n of nodes) {
      if (n.pinned) continue;
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx * alpha;
      n.y += n.vy * alpha;
    }
  }
  return nodes;
}

// ── Component ────────────────────────────────────────────────

interface Props {
  personId: string | number;
  personName: string;
}

export default function ConnectionsGraphPanel({ personId, personName }: Props) {
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ nodes: any[]; edges: any[] }>(
        `/connections/graph?type=person&id=${personId}&depth=1`
      );
      const centerX = 300, centerY = 200;
      const newNodes: GraphNode[] = data.nodes.map((n, i) => {
        const isSeed = n.type === 'person' && String(n.entityId) === String(personId);
        return {
          id: n.id,
          type: n.type,
          label: (n.label || '').toUpperCase(),
          subLabel: n.metadata?.status || n.metadata?.incident_type || '',
          x: isSeed ? centerX : centerX + Math.cos(i) * 140 + Math.random() * 20,
          y: isSeed ? centerY : centerY + Math.sin(i) * 140 + Math.random() * 20,
          vx: 0, vy: 0,
          pinned: isSeed,
        };
      });
      const newEdges: GraphEdge[] = data.edges.map(e => ({
        source: e.source, target: e.target, label: (e.relationship || '').toUpperCase(),
      }));
      simulate(newNodes, newEdges);

      // Normalize positions to fit viewport
      if (newNodes.length > 1) {
        const minX = Math.min(...newNodes.map(n => n.x));
        const maxX = Math.max(...newNodes.map(n => n.x));
        const minY = Math.min(...newNodes.map(n => n.y));
        const maxY = Math.max(...newNodes.map(n => n.y));
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const pad = 50;
        const w = 600 - 2 * pad;
        const h = 400 - 2 * pad;
        for (const n of newNodes) {
          n.x = pad + ((n.x - minX) / rangeX) * w;
          n.y = pad + ((n.y - minY) / rangeY) * h;
        }
      }

      setNodes(newNodes);
      setEdges(newEdges);
    } catch (err) {
      console.error('ConnectionsGraph fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [personId, personName]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  if (nodes.length <= 1 && !loading) return null; // No connections — hide

  const viewW = expanded ? 900 : 600;
  const viewH = expanded ? 600 : 400;

  return (
    <CollapsibleSection
      title="Connections Graph"
      icon={Network}
      defaultOpen={false}
    >
      <div className="relative">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="absolute top-1 right-1 z-10 toolbar-btn"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-rmpg-400" />
            <span className="ml-2 text-xs text-rmpg-400">Building graph...</span>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${viewW} ${viewH}`}
            className="w-full bg-surface-sunken rounded-sm border border-rmpg-700"
            style={{ minHeight: expanded ? 500 : 300 }}
          >
            {/* Edges */}
            {edges.map((e, i) => {
              const src = nodes.find(n => n.id === e.source);
              const tgt = nodes.find(n => n.id === e.target);
              if (!src || !tgt) return null;
              const mx = (src.x + tgt.x) / 2;
              const my = (src.y + tgt.y) / 2;
              return (
                <g key={`edge-${i}`}>
                  <line
                    x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                    stroke="#333" strokeWidth={1.5} strokeDasharray="4,3"
                  />
                  {e.label && (
                    <text x={mx} y={my - 4} textAnchor="middle" fontSize={7} fill="#666" fontFamily="monospace">
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {nodes.map(n => {
              const r = NODE_RADIUS[n.type] || 16;
              const color = NODE_COLORS[n.type] || '#888';
              const isHovered = hoveredNode === n.id;
              return (
                <g
                  key={n.id}
                  onMouseEnter={() => setHoveredNode(n.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Glow on hover */}
                  {isHovered && (
                    <circle cx={n.x} cy={n.y} r={r + 4} fill="none" stroke={color} strokeWidth={2} opacity={0.4} />
                  )}
                  {/* Node circle */}
                  <circle
                    cx={n.x} cy={n.y} r={r}
                    fill="#0a0a0a" stroke={color} strokeWidth={2}
                  />
                  {/* Type icon letter */}
                  <text
                    x={n.x} y={n.y - 2} textAnchor="middle" dominantBaseline="middle"
                    fontSize={r > 20 ? 10 : 8} fill={color} fontFamily="monospace" fontWeight="bold"
                  >
                    {n.type === 'person' ? '👤' : n.type[0].toUpperCase()}
                  </text>
                  {/* Label below */}
                  <text
                    x={n.x} y={n.y + r + 10} textAnchor="middle"
                    fontSize={8} fill="#ccc" fontFamily="monospace"
                  >
                    {n.label.length > 18 ? n.label.slice(0, 16) + '…' : n.label}
                  </text>
                  {/* Sub-label */}
                  {n.subLabel && (
                    <text
                      x={n.x} y={n.y + r + 19} textAnchor="middle"
                      fontSize={6} fill="#666" fontFamily="monospace"
                    >
                      {n.subLabel}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Legend */}
            {(() => {
              const types = [...new Set(nodes.map(n => n.type))];
              return types.map((t, i) => (
                <g key={`legend-${t}`} transform={`translate(10, ${viewH - 14 - (types.length - 1 - i) * 14})`}>
                  <circle cx={6} cy={0} r={4} fill={NODE_COLORS[t]} />
                  <text x={14} y={3} fontSize={8} fill="#888" fontFamily="monospace">
                    {t.toUpperCase()}
                  </text>
                </g>
              ));
            })()}
          </svg>
        )}
      </div>
    </CollapsibleSection>
  );
}
