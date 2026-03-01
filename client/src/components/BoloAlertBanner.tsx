// ============================================================
// RMPG Flex — BOLO Alert Banner
// Debounced auto-check of active BOLOs for matching vehicle or
// subject descriptions. Shown inline in NewCallModal and
// DispatchPage call detail. Plays a warning tone on match.
// Follows SafetyScreening.tsx pattern for tone + debounce.
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { Siren, ExternalLink } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { playTone } from '../utils/dispatchTones';

interface BoloMatch {
  id: number;
  bolo_number: string;
  type: string;
  title: string;
  description?: string;
  subject_description?: string;
  vehicle_description?: string;
  priority: string;
  created_at: string;
  expires_at?: string;
}

interface BoloAlertBannerProps {
  /** Location address for the call */
  address?: string;
  /** Subject description text to match against */
  subject?: string;
  /** Vehicle description text to match against */
  vehicle?: string;
  /** Navigate to BOLO detail */
  onViewBolo?: (boloId: number) => void;
}

export default function BoloAlertBanner({ address, subject, vehicle, onViewBolo }: BoloAlertBannerProps) {
  const [matches, setMatches] = useState<BoloMatch[]>([]);
  const tonePlayedRef = useRef<string>('');

  useEffect(() => {
    // Need at least one searchable field with meaningful content
    const hasInput =
      (address && address.length >= 5) ||
      (subject && subject.length >= 4) ||
      (vehicle && vehicle.length >= 4);

    if (!hasInput) {
      setMatches([]);
      return;
    }

    const debounce = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (address) params.set('address', address);
        if (subject) params.set('subject', subject);
        if (vehicle) params.set('vehicle', vehicle);

        const result = await apiFetch<{ matches: BoloMatch[]; count: number }>(
          `/comms/bolos/check?${params.toString()}`
        );
        setMatches(result.matches || []);

        // Play warning tone (once per unique match set)
        const matchKey = (result.matches || []).map(m => m.id).join(',');
        if (result.count > 0 && tonePlayedRef.current !== matchKey) {
          tonePlayedRef.current = matchKey;
          playTone('warning');
        }
      } catch {
        setMatches([]);
      }
    }, 800);

    return () => clearTimeout(debounce);
  }, [address, subject, vehicle]);

  if (matches.length === 0) return null;

  return (
    <div
      className="animate-emergency-blink"
      style={{
        background: 'rgba(220, 38, 38, 0.15)',
        border: '1px solid #dc2626',
        padding: '6px 8px',
        marginTop: 4,
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Siren style={{ width: 12, height: 12, color: '#ef4444' }} />
        <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
          BOLO MATCH — {matches.length} Active Alert{matches.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {matches.slice(0, 3).map((bolo) => (
          <div key={bolo.id} className="flex items-start gap-2 text-[9px]">
            <span
              className="font-black px-1 py-px text-[8px] flex-shrink-0"
              style={{
                background: bolo.priority === 'P1' ? '#ef4444' : bolo.priority === 'P2' ? '#f97316' : '#eab308',
                color: '#fff',
              }}
            >
              {bolo.priority}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-red-400 font-bold font-mono">{bolo.bolo_number}</span>
                <span className="text-white font-semibold truncate">{bolo.title}</span>
                {onViewBolo && (
                  <button
                    onClick={() => onViewBolo(bolo.id)}
                    className="text-rmpg-500 hover:text-red-400 flex-shrink-0"
                    title="View BOLO"
                  >
                    <ExternalLink style={{ width: 9, height: 9 }} />
                  </button>
                )}
              </div>
              {bolo.subject_description && (
                <div className="text-rmpg-400 truncate">Subject: {bolo.subject_description}</div>
              )}
              {bolo.vehicle_description && (
                <div className="text-rmpg-400 truncate">Vehicle: {bolo.vehicle_description}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
