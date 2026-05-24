// ============================================================
// RMPG Flex — Run Card Preview
// Live preview of the dispatch template that will apply when
// this call is created. Renders inline in NewCallModal under
// the Incident Type select. Silent (returns null) when no
// active card matches.
// ============================================================

import { useEffect, useState } from 'react';
import { AlertTriangle, Users, ShieldAlert, VolumeX, Ambulance, Flame, Radio } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

export interface RunCard {
  id: number;
  incident_type: string;
  display_name: string;
  default_priority: string;
  required_units: number;
  backup_units: number;
  required_roles: string[];
  auto_flags: Record<string, unknown>;
  recommended_codes: string[];
  officer_safety_alert: boolean;
  silent_response_default: boolean;
  ems_requested: boolean;
  fire_requested: boolean;
  notes: string | null;
  active: boolean;
}

const PRIORITY_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  P1: { bg: 'rgba(239,68,68,0.10)', border: '#ef4444', text: '#ef4444', label: 'P1 EMERGENCY' },
  P2: { bg: 'rgba(245,158,11,0.10)', border: '#f59e0b', text: '#f59e0b', label: 'P2 URGENT' },
  P3: { bg: 'rgba(107,114,128,0.10)', border: '#888', text: '#ccc', label: 'P3 ROUTINE' },
  P4: { bg: 'rgba(34,197,94,0.10)', border: '#22c55e', text: '#22c55e', label: 'P4 NON-URGENT' },
};

interface Props {
  incidentType: string;
  onCardLoaded?: (card: RunCard | null) => void;
}

export default function RunCardPreview({ incidentType, onCardLoaded }: Props) {
  const [card, setCard] = useState<RunCard | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!incidentType) {
      setCard(null);
      onCardLoaded?.(null);
      return;
    }
    setLoading(true);
    apiFetch<RunCard>(`/api/dispatch/run-cards/by-type/${encodeURIComponent(incidentType)}`)
      .then((c) => {
        if (cancelled) return;
        setCard(c);
        onCardLoaded?.(c);
      })
      .catch(() => {
        if (cancelled) return;
        setCard(null);
        onCardLoaded?.(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // intentionally omit onCardLoaded to avoid loop if parent doesn't memoize
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentType]);

  if (loading) {
    return (
      <div className="text-[10px] text-rmpg-500 uppercase tracking-wider px-2 py-1">
        Loading run card…
      </div>
    );
  }
  if (!card) return null;

  const p = PRIORITY_STYLES[card.default_priority] || PRIORITY_STYLES.P3;
  const totalUnits = card.required_units + card.backup_units;

  return (
    <div
      className="border p-2 space-y-1.5"
      style={{ background: p.bg, borderColor: p.border, borderRadius: 2 }}
      data-testid="run-card-preview"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Radio className="w-3.5 h-3.5" style={{ color: p.text }} />
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: p.text }}>
          Run Card · {card.display_name}
        </span>
        <span
          className="text-[9px] font-bold px-1.5 py-0.5 uppercase"
          style={{ background: p.border, color: '#0a0a0a', borderRadius: 2 }}
        >
          {p.label}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-rmpg-200 flex-wrap">
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3 text-brand-gold-500" />
          <strong className="text-white">{totalUnits}</strong> unit{totalUnits !== 1 ? 's' : ''}
          {card.backup_units > 0 && (
            <span className="text-rmpg-400">({card.required_units}+{card.backup_units} backup)</span>
          )}
        </span>
        {card.required_roles.length > 0 && (
          <span className="text-rmpg-300">
            Roles: <strong className="text-white">{card.required_roles.join(', ')}</strong>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {card.officer_safety_alert && (
          <span className="text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 px-1.5 py-0.5"
            style={{ background: 'rgba(239,68,68,0.20)', color: '#ef4444', borderRadius: 2 }}>
            <ShieldAlert className="w-3 h-3" /> OFC SAFETY
          </span>
        )}
        {card.silent_response_default && (
          <span className="text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 px-1.5 py-0.5"
            style={{ background: 'rgba(107,114,128,0.25)', color: '#fbbf24', borderRadius: 2 }}>
            <VolumeX className="w-3 h-3" /> SILENT RESP
          </span>
        )}
        {card.ems_requested && (
          <span className="text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 px-1.5 py-0.5"
            style={{ background: 'rgba(59,130,246,0.20)', color: '#60a5fa', borderRadius: 2 }}>
            <Ambulance className="w-3 h-3" /> EMS
          </span>
        )}
        {card.fire_requested && (
          <span className="text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 px-1.5 py-0.5"
            style={{ background: 'rgba(245,158,11,0.20)', color: '#fbbf24', borderRadius: 2 }}>
            <Flame className="w-3 h-3" /> FIRE
          </span>
        )}
        {card.recommended_codes.map((c) => (
          <span key={c} className="text-[9px] font-mono px-1.5 py-0.5"
            style={{ background: '#1a1a1a', color: '#d4a017', borderRadius: 2 }}>
            {c}
          </span>
        ))}
      </div>

      {card.notes && (
        <div className="text-[10px] text-rmpg-300 italic flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0 text-brand-gold-500" />
          <span>{card.notes}</span>
        </div>
      )}
    </div>
  );
}
