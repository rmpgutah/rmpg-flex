import { useEffect, useRef } from 'react';
import { useDistrictOptions, useDistrictIdentify } from '../hooks/useDistrictLookup';

// Three cascading <select> controls for the dispatch S/Z/B hierarchy.
// Sector is parent of Zone is parent of Beat — picking a sector resets
// downstream values to avoid orphaned combos. Optionally auto-fills from
// lat/lng using the server's identifyBeat() geofence lookup, only when
// the current values are empty (manual edits are sticky).
//
// Field naming follows the existing schema: sector_id, zone_id, beat_id
// (TEXT codes, not numeric FKs).

export interface SectorZoneBeatPickerProps {
  sectorId: string;
  zoneId: string;
  beatId: string;
  onChange: (next: { sector_id: string; zone_id: string; beat_id: string }) => void;
  /** Auto-resolve via /dispatch/districts/identify when these change and current values are empty. */
  latitude?: number | null;
  longitude?: number | null;
  /** Override the row layout (defaults to 3-column grid). */
  className?: string;
  /** Tighter label/select sizing for dense forms. */
  compact?: boolean;
  /** Hide labels (caller renders its own). */
  hideLabels?: boolean;
  disabled?: boolean;
}

export default function SectorZoneBeatPicker({
  sectorId,
  zoneId,
  beatId,
  onChange,
  latitude,
  longitude,
  className,
  compact = false,
  hideLabels = false,
  disabled = false,
}: SectorZoneBeatPickerProps) {
  const { sections, sectionLabels, zoneLabels, zonesForSection, beatsForZone, getBeatLabel, loading } = useDistrictOptions();
  const { identify } = useDistrictIdentify();

  // Auto-resolve from coordinates — only when nothing is set yet, so manual
  // edits aren't clobbered the next time coords change.
  const lastResolvedRef = useRef<string | null>(null);
  useEffect(() => {
    if (latitude == null || longitude == null) return;
    if (sectorId || zoneId || beatId) return;
    const coordKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    if (lastResolvedRef.current === coordKey) return;
    lastResolvedRef.current = coordKey;
    identify(latitude, longitude).then((info) => {
      if (info) onChange({ sector_id: info.sector_id, zone_id: info.zone_id, beat_id: info.beat_id });
    });
  }, [latitude, longitude, sectorId, zoneId, beatId, identify, onChange]);

  const labelCls = compact
    ? 'text-[9px] text-rmpg-400 uppercase font-semibold'
    : 'text-[10px] text-rmpg-400 uppercase font-semibold';
  const selectCls = 'select-dark mt-1';
  const wrapCls = className ?? 'grid grid-cols-3 gap-3';

  return (
    <div className={wrapCls}>
      <div>
        {!hideLabels && <label className={labelCls}>Sector</label>}
        <select
          className={selectCls}
          value={sectorId}
          disabled={disabled || loading}
          onChange={(e) => onChange({ sector_id: e.target.value, zone_id: '', beat_id: '' })}
        >
          <option value="">-- Select --</option>
          {sections.map((s) => (
            <option key={s} value={s}>{s} — {sectionLabels.get(s) || s}</option>
          ))}
        </select>
      </div>
      <div>
        {!hideLabels && <label className={labelCls}>Zone</label>}
        <select
          className={selectCls}
          value={zoneId}
          disabled={disabled || loading || !sectorId}
          onChange={(e) => onChange({ sector_id: sectorId, zone_id: e.target.value, beat_id: '' })}
        >
          <option value="">-- Select --</option>
          {zonesForSection(sectorId).map((z) => (
            <option key={z} value={z}>{z} — {zoneLabels.get(z) || z}</option>
          ))}
        </select>
      </div>
      <div>
        {!hideLabels && <label className={labelCls}>Beat</label>}
        <select
          className={selectCls}
          value={beatId}
          disabled={disabled || loading || !zoneId}
          onChange={(e) => onChange({ sector_id: sectorId, zone_id: zoneId, beat_id: e.target.value })}
        >
          <option value="">-- Select --</option>
          {beatsForZone(zoneId).map((b) => (
            <option key={b} value={b}>{b} — {getBeatLabel(zoneId, b)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
