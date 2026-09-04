// ============================================================
// RMPG Flex — Premise History Panel
// Displays prior calls at an address and plays alert tones
// when hazardous history is found. Used inline in call creation.
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Clock, Shield, ShieldBan, MapPin, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { playTone } from '../utils/dispatchTones';
import { formatIncidentType } from '../utils/caseNumbers';
import { toDisplayLabel } from '../utils/formatters';
import { safeDateStr } from '../utils/dateUtils';

interface PremiseCall {
  id: number;
  call_number: string;
  incident_type: string;
  priority: string;
  status: string;
  disposition?: string;
  location_address: string;
  created_at: string;
  cleared_at?: string;
  weapons_involved?: boolean;
  domestic_violence?: boolean;
  injuries_reported?: boolean;
  description?: string;
}

interface PremiseResult {
  calls: PremiseCall[];
  total: number;
  hasWarnings: boolean;
  warningTypes: string[];
  propertyHazard: string | null;
}

interface Occupant {
  id: number;
  name: string;
  dob: string | null;
  flags: string[];
  gang: string | null;
  active_warrants: number;
  caution: boolean;
}
interface OccupantResult {
  occupants: Occupant[];
  occupant_count: number;
  has_flagged: boolean;
}

interface TrespassOrderHit {
  id: number;
  order_number: string;
  subject_first_name: string;
  subject_last_name: string;
  subject_description?: string;
  order_type: string;
  status: string;
  reason?: string;
  effective_date?: string;
  expiration_date?: string;
  property_name?: string;
  location?: string;
}

interface TrespassCheckResult {
  orders: TrespassOrderHit[];
  count: number;
}

interface PremiseHistoryProps {
  address: string;
  propertyId?: string;
  onClose?: () => void;
  compact?: boolean;   // inline mode (smaller) vs. panel mode
}

export default function PremiseHistory({ address, propertyId, onClose, compact = false }: PremiseHistoryProps) {
  const [data, setData] = useState<PremiseResult | null>(null);
  const [trespassOrders, setTrespassOrders] = useState<TrespassOrderHit[]>([]);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tonePlayedRef = useRef<string>('');  // track which address we've played tone for

  useEffect(() => {
    if (!address || address.length < 3) {
      setData(null);
      setTrespassOrders([]);
      setOccupants([]);
      return;
    }

    const debounce = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch premise history, trespass orders, and on-file occupants in parallel.
        const [premiseResult, trespassResult, occupantResult] = await Promise.all([
          apiFetch<PremiseResult>(
            `/dispatch/premise-history?address=${encodeURIComponent(address)}`
          ),
          apiFetch<TrespassCheckResult>(
            `/trespass-orders/check?${propertyId ? `property_id=${propertyId}` : `address=${encodeURIComponent(address)}`}`
          ).catch(() => ({ orders: [], count: 0 }) as TrespassCheckResult),
          apiFetch<OccupantResult>(
            `/dispatch/address-occupants?address=${encodeURIComponent(address)}`
          ).catch(() => ({ occupants: [], occupant_count: 0, has_flagged: false }) as OccupantResult),
        ]);

        setData(premiseResult);
        setTrespassOrders(trespassResult.orders || []);
        setOccupants(occupantResult.occupants || []);

        // Play alert tone (only once per address)
        if (tonePlayedRef.current !== address) {
          tonePlayedRef.current = address;
          if (trespassResult.count > 0) {
            // Active trespass orders are highest priority alert
            playTone('warning');
          } else if (premiseResult.hasWarnings || occupantResult.has_flagged) {
            // A flagged occupant (active warrant / gang / caution) is a warning.
            playTone('warning');
          } else if (premiseResult.total > 0 || (occupantResult.occupant_count || 0) > 0) {
            playTone('caution');
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load premise history');
      } finally {
        setLoading(false);
      }
    }, 500);  // debounce 500ms

    return () => clearTimeout(debounce);
  }, [address, propertyId]);

  if (!address || address.length < 3) return null;
  if (loading) {
    return (
      <div className={`premise-history ${compact ? 'premise-compact' : ''}`}>
        <div className="premise-loading">
          <span className="animate-pulse text-[10px] text-rmpg-400 font-mono">CHECKING PREMISE HISTORY...</span>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className={`premise-history ${compact ? 'premise-compact' : ''}`}>
        <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] text-amber-400 bg-amber-900/30 border border-amber-700/50">
          <AlertTriangle style={{ width: 11, height: 11, flexShrink: 0 }} />
          <span className="font-bold">PREMISE CHECK FAILED</span>
          <span className="text-amber-500">{error}</span>
        </div>
      </div>
    );
  }
  if ((!data || data.total === 0) && trespassOrders.length === 0 && occupants.length === 0) return null;

  const hasTrespassOrders = trespassOrders.length > 0;
  const flaggedOccupants = occupants.filter((o) => o.caution);

  const priorityColor = (p: string) => {
    switch (p) {
      case 'P1': return 'var(--sev-critical)';
      case 'P2': return 'var(--sev-high)';
      case 'P3': return 'var(--sev-warn)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <div className={`premise-history ${compact ? 'premise-compact' : ''} ${data?.hasWarnings || hasTrespassOrders ? 'premise-warning' : ''}`}>
      {/* Header */}
      <div className="premise-header">
        <div className="flex items-center gap-1.5">
          {(data?.hasWarnings || hasTrespassOrders) ? (
            <AlertTriangle style={{ width: 12, height: 12, color: 'var(--sev-critical)' }} className="animate-emergency-blink" />
          ) : (
            <MapPin style={{ width: 11, height: 11, color: 'var(--sev-ok)' }} />
          )}
          <span className="text-[10px] font-bold uppercase tracking-wider">
            Premise History{data && data.total > 0 ? ` — ${data.total} Prior Call${data.total !== 1 ? 's' : ''}` : ''}
            {hasTrespassOrders ? ` — ${trespassOrders.length} Trespass Order${trespassOrders.length !== 1 ? 's' : ''}` : ''}
          </span>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="text-fg-muted hover:text-rmpg-100">
            <X style={{ width: 12, height: 12 }} />
          </button>
        )}
      </div>

      {/* Trespass Order Alert Banner */}
      {hasTrespassOrders && (
        <div
          className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-bold animate-emergency-blink"
          style={{
            background: 'rgba(220, 38, 38, 0.3)',
            borderBottom: '1px solid color-mix(in srgb, var(--sev-critical) 60%, transparent)',
            color: 'var(--sev-critical-soft)',
          }}
        >
          <ShieldBan style={{ width: 12, height: 12, flexShrink: 0 }} />
          <span>ACTIVE TRESPASS ORDER{trespassOrders.length > 1 ? 'S' : ''}:</span>
          {trespassOrders.map(to => (
            <span key={to.id} className="px-1.5 py-0.5" style={{ background: 'color-mix(in srgb, var(--sev-critical) 30%, transparent)', border: '1px solid var(--sev-critical)' }}>
              {(to.subject_last_name || '').toUpperCase()}, {to.subject_first_name || ''} — {toDisplayLabel(to.order_type || '').toUpperCase()}
            </span>
          ))}
        </div>
      )}

      {/* Warning banner */}
      {data?.hasWarnings && (
        <div className="premise-warning-banner">
          <Shield style={{ width: 11, height: 11 }} />
          <span>OFFICER SAFETY:</span>
          {data.warningTypes.map(w => (
            <span key={w} className="premise-warning-tag">{toDisplayLabel(w)}</span>
          ))}
        </div>
      )}

      {/* Property hazard */}
      {data?.propertyHazard && (
        <div className="premise-hazard">
          <AlertTriangle style={{ width: 10, height: 10 }} />
          <span>{data.propertyHazard}</span>
        </div>
      )}

      {/* Flagged-occupant officer-safety banner */}
      {flaggedOccupants.length > 0 && (
        <div
          className="flex items-center gap-1.5 flex-wrap px-2 py-1.5 text-[10px] font-bold animate-emergency-blink"
          style={{ background: 'color-mix(in srgb, var(--sev-critical) 30%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--sev-critical) 60%, transparent)', color: 'var(--sev-critical-soft)' }}
        >
          <Shield style={{ width: 12, height: 12, flexShrink: 0 }} />
          <span>FLAGGED AT ADDRESS:</span>
          {flaggedOccupants.map((o) => (
            <span key={o.id} className="px-1.5 py-0.5" style={{ background: 'color-mix(in srgb, var(--sev-critical) 30%, transparent)', border: '1px solid var(--sev-critical)' }}>
              {o.name.toUpperCase()}
              {o.active_warrants > 0 ? ` — ${o.active_warrants} WARRANT${o.active_warrants > 1 ? 'S' : ''}` : ''}
              {o.gang ? ` — GANG: ${o.gang.toUpperCase()}` : ''}
            </span>
          ))}
        </div>
      )}

      {/* On-file occupants (individual records cross-referenced by address) */}
      {occupants.length > 0 && (
        <div className="premise-call-list">
          <div className="px-2 pt-1 text-[8px] font-bold uppercase tracking-wide text-fg-muted">
            On File At Address — {occupants.length} Individual{occupants.length !== 1 ? 's' : ''}
          </div>
          {occupants.slice(0, compact ? 4 : 15).map((o) => (
            <div key={o.id} className="premise-call-item flex items-center gap-1.5" style={o.caution ? { borderLeft: '2px solid var(--sev-critical)' } : undefined}>
              <span className="text-[10px] font-semibold" style={{ color: o.caution ? 'var(--sev-critical-soft)' : 'var(--text-secondary)' }}>{o.name}</span>
              {o.dob && <span className="text-[9px] text-fg-muted">DOB {o.dob}</span>}
              {o.active_warrants > 0 && (
                <span className="text-[8px] font-black px-1 py-px" style={{ background: 'color-mix(in srgb, var(--sev-critical) 60%, transparent)', color: 'var(--text-primary)' }}>
                  {o.active_warrants} WARRANT{o.active_warrants > 1 ? 'S' : ''}
                </span>
              )}
              {o.gang && (
                <span className="text-[8px] font-bold px-1 py-px" style={{ background: 'color-mix(in srgb, var(--sev-high) 30%, transparent)', border: '1px solid var(--sev-high)', color: 'var(--sev-high)' }}>
                  {o.gang}
                </span>
              )}
              {o.flags.filter((f) => /caution|armed|violent|danger|weapon/i.test(f)).slice(0, 3).map((f) => (
                <span key={f} className="text-[8px] px-1 py-px uppercase" style={{ background: 'color-mix(in srgb, var(--sev-warn) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-warn) 60%, transparent)', color: 'var(--sev-warn)' }}>{f}</span>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Call list */}
      {data && data.calls.length > 0 && (
      <div className="premise-call-list">
        {data.calls.slice(0, compact ? 3 : 10).map(call => (
          <div key={call.id} className="premise-call-item">
            <div className="flex items-center gap-1.5">
              <span
                className="text-[8px] font-black px-1 py-px"
                style={{
                  background: priorityColor(call.priority),
                  color: 'var(--text-primary)',
                  minWidth: 18,
                  textAlign: 'center',
                }}
              >
                {(call.priority || '').toUpperCase()}
              </span>
              <span className="text-[10px] font-mono text-rmpg-300">{call.call_number}</span>
              <span className="text-[10px] font-semibold text-rmpg-100">
                {formatIncidentType(call.incident_type)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-fg-muted">
              <Clock style={{ width: 9, height: 9 }} />
              <span>{safeDateStr(call.created_at)}</span>
              {call.disposition && <span>• {toDisplayLabel(call.disposition)}</span>}
              {call.weapons_involved && <span className="text-red-500 font-bold">WEAPONS</span>}
              {call.domestic_violence && <span className="text-orange-500 font-bold">DV</span>}
            </div>
          </div>
        ))}
        {data.total > (compact ? 3 : 10) && (
          <div className="text-[9px] text-fg-muted text-center py-1">
            + {data.total - (compact ? 3 : 10)} more prior calls
          </div>
        )}
      </div>
      )}
    </div>
  );
}
