// ============================================================
// RMPG Flex — Premise History Panel
// Displays prior calls at an address and plays alert tones
// when hazardous history is found. Used inline in call creation.
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Clock, Shield, ShieldBan, MapPin, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { playTone } from '../utils/dispatchTones';
import { formatIncidentType } from '../utils/caseNumbers';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tonePlayedRef = useRef<string>('');  // track which address we've played tone for

  useEffect(() => {
    if (!address || address.length < 3) {
      setData(null);
      setTrespassOrders([]);
      return;
    }

    const debounce = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch premise history and trespass orders in parallel
        const [premiseResult, trespassResult] = await Promise.all([
          apiFetch<PremiseResult>(
            `/dispatch/premise-history?address=${encodeURIComponent(address)}`
          ),
          apiFetch<TrespassCheckResult>(
            `/trespass-orders/check?${propertyId ? `property_id=${propertyId}` : `address=${encodeURIComponent(address)}`}`
          ).catch(() => ({ orders: [], count: 0 }) as TrespassCheckResult),
        ]);

        setData(premiseResult);
        setTrespassOrders(trespassResult.orders || []);

        // Play alert tone (only once per address)
        if (tonePlayedRef.current !== address) {
          tonePlayedRef.current = address;
          if (trespassResult.count > 0) {
            // Active trespass orders are highest priority alert
            playTone('warning');
          } else if (premiseResult.hasWarnings) {
            playTone('warning');
          } else if (premiseResult.total > 0) {
            playTone('caution');
          }
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load premise history');
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
  if (error) return null;
  if ((!data || data.total === 0) && trespassOrders.length === 0) return null;

  const hasTrespassOrders = trespassOrders.length > 0;

  const priorityColor = (p: string) => {
    switch (p) {
      case 'P1': return '#ef4444';
      case 'P2': return '#f97316';
      case 'P3': return '#eab308';
      default: return '#6b7280';
    }
  };

  return (
    <div className={`premise-history ${compact ? 'premise-compact' : ''} ${data?.hasWarnings || hasTrespassOrders ? 'premise-warning' : ''}`}>
      {/* Header */}
      <div className="premise-header">
        <div className="flex items-center gap-1.5">
          {(data?.hasWarnings || hasTrespassOrders) ? (
            <AlertTriangle style={{ width: 12, height: 12, color: '#ef4444' }} className="animate-emergency-blink" />
          ) : (
            <MapPin style={{ width: 11, height: 11, color: '#4ade80' }} />
          )}
          <span className="text-[10px] font-bold uppercase tracking-wider">
            Premise History{data && data.total > 0 ? ` — ${data.total} Prior Call${data.total !== 1 ? 's' : ''}` : ''}
            {hasTrespassOrders ? ` — ${trespassOrders.length} Trespass Order${trespassOrders.length !== 1 ? 's' : ''}` : ''}
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-rmpg-500 hover:text-white">
            <X style={{ width: 12, height: 12 }} />
          </button>
        )}
      </div>

      {/* Trespass Order Alert Banner */}
      {hasTrespassOrders && (
        <div
          className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-bold animate-emergency-blink"
          style={{
            background: 'rgba(26, 90, 158, 0.3)',
            borderBottom: '1px solid #164d88',
            color: '#ff6b6b',
          }}
        >
          <ShieldBan style={{ width: 12, height: 12, flexShrink: 0 }} />
          <span>ACTIVE TRESPASS ORDER{trespassOrders.length > 1 ? 'S' : ''}:</span>
          {trespassOrders.map(to => (
            <span key={to.id} className="px-1.5 py-0.5" style={{ background: 'rgba(239,68,68,0.3)', border: '1px solid #ef4444' }}>
              {to.subject_last_name?.toUpperCase()}, {to.subject_first_name} — {to.order_type?.replace(/_/g, ' ').toUpperCase()}
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
            <span key={w} className="premise-warning-tag">{w.replace(/_/g, ' ')}</span>
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
                  color: '#fff',
                  minWidth: 18,
                  textAlign: 'center',
                }}
              >
                {call.priority}
              </span>
              <span className="text-[10px] font-mono text-rmpg-300">{call.call_number}</span>
              <span className="text-[10px] font-semibold text-white">
                {formatIncidentType(call.incident_type)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-rmpg-500">
              <Clock style={{ width: 9, height: 9 }} />
              <span>{new Date(call.created_at).toLocaleDateString()}</span>
              {call.disposition && <span>• {call.disposition}</span>}
              {call.weapons_involved && <span className="text-red-500 font-bold">WEAPONS</span>}
              {call.domestic_violence && <span className="text-orange-500 font-bold">DV</span>}
            </div>
          </div>
        ))}
        {data.total > (compact ? 3 : 10) && (
          <div className="text-[9px] text-rmpg-500 text-center py-1">
            + {data.total - (compact ? 3 : 10)} more prior calls
          </div>
        )}
      </div>
      )}
    </div>
  );
}
