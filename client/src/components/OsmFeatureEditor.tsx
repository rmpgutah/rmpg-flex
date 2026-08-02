// ============================================================
// RMPG Flex — OSM feature editor
// ============================================================
// The edit affordance for RMPG's internal override layer. OpenStreetMap data
// is crowd-sourced and read-only to us; this is where an officer records what
// is actually true on the ground.
//
// Nothing here mutates OSM. The panel writes an override row keyed by the
// OpenStreetMap element id; the original tags stay in the tile archive and
// keep rendering underneath. That separation is deliberate — this is an
// authoritative records system, so a correction must stay attributable to the
// person who made it, and the source data must stay attributable to OSM.
// ============================================================

import { useState, useEffect, useMemo } from 'react';
import { Check, EyeOff, Trash2, X, ExternalLink } from 'lucide-react';
import IconButton from './IconButton';
import type { OsmOverride, SaveOverridePatch } from '../hooks/useOsmOverrides';

export interface OsmFeatureEditorProps {
  /** OpenStreetMap element id, e.g. 'n83099358'. */
  osmId: string;
  /** Archive group the feature belongs to ('safety', 'surveillance', ...). */
  group: string;
  /** Category within the group ('hydrant', 'alpr', ...). */
  cat?: string | null;
  /** Human label for the heading. */
  categoryLabel?: string;
  /** Feature name from OSM, if any. */
  featureName?: string;
  /** The OSM tags, so a correction can be seeded from the current value. */
  osmTags?: Record<string, unknown>;
  /** Existing override, when this feature already has one. */
  existing?: OsmOverride | null;
  onSave: (patch: SaveOverridePatch) => Promise<unknown>;
  onClear: () => Promise<unknown>;
  onClose: () => void;
}

/** Tags an officer is realistically correcting in the field. Deliberately
 *  short — a free-form tag editor invites typos into a records system, and
 *  anything else belongs upstream in OpenStreetMap itself. */
const EDITABLE_TAGS: Array<{ key: string; label: string; placeholder: string }> = [
  { key: 'name', label: 'Name', placeholder: 'Feature name' },
  { key: 'operator', label: 'Operator', placeholder: 'Who runs it' },
  { key: 'colour', label: 'Colour', placeholder: 'e.g. red' },
  { key: 'access', label: 'Access', placeholder: 'private / no / yes' },
  { key: 'fire_hydrant:type', label: 'Hydrant type', placeholder: 'pillar / underground' },
  { key: 'surveillance:zone', label: 'Camera covers', placeholder: 'What it watches' },
  { key: 'camera:direction', label: 'Facing (deg)', placeholder: '0-359' },
];

export default function OsmFeatureEditor({
  osmId, group, cat, categoryLabel, featureName, osmTags = {},
  existing, onSave, onClear, onClose,
}: OsmFeatureEditorProps) {
  const [note, setNote] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the editor is pointed at a different feature, or the
  // previous feature's edits would bleed into the next one.
  useEffect(() => {
    setNote(existing?.note ?? '');
    setFields(
      Object.fromEntries(
        Object.entries(existing?.fields ?? {}).map(([k, v]) => [k, v === null ? '' : String(v)]),
      ),
    );
    setHidden(existing?.hidden ?? false);
    setVerified(existing?.verified ?? false);
    setError(null);
  }, [osmId, existing]);

  // Only offer tags this feature actually has, plus any already overridden —
  // a hydrant has no camera bearing, and offering one invites nonsense data.
  const rows = useMemo(
    () => EDITABLE_TAGS.filter(
      (t) => osmTags[t.key] !== undefined || existing?.fields?.[t.key] !== undefined,
    ),
    [osmTags, existing],
  );

  const osmType = osmId[0] === 'n' ? 'node' : osmId[0] === 'w' ? 'way' : 'relation';

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      // Only send fields that differ from the OSM value. Persisting an
      // unchanged value as an "override" would mark the field as corrected in
      // the popup and misattribute OSM's own data to RMPG.
      const changed: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        const original = osmTags[k] === undefined || osmTags[k] === null ? '' : String(osmTags[k]);
        if (v.trim() !== '' && v !== original) changed[k] = v;
      }
      await onSave({
        group,
        cat: cat ?? null,
        note: note.trim() === '' ? null : note,
        fields: changed,
        hidden,
        verified,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setError(null);
    try {
      await onClear();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col max-h-[70vh] w-[320px] bg-surface-raised border border-border-default"
      style={{ borderRadius: 2 }}
      role="dialog"
      aria-label="Edit map feature"
    >
      {/* Header stays put; only the body scrolls, so Save is never pushed
          offscreen on a feature with many editable tags. */}
      <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-border-default flex-none">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-rmpg-100 truncate">
            {featureName || categoryLabel || 'Map feature'}
          </div>
          <div className="text-[8px] uppercase tracking-wide text-fg-muted">
            RMPG override · does not change OpenStreetMap
          </div>
        </div>
        <IconButton aria-label="Close editor" onClick={onClose} className="flex-none">
          <X size={14} />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        <div>
          <label htmlFor="osm-note" className="block text-[9px] uppercase tracking-wide text-fg-muted mb-1">
            Operational note
          </label>
          <textarea
            id="osm-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="e.g. Capped — out of service"
            className="w-full bg-surface-sunken border border-border-default text-[11px] text-rmpg-100 px-2 py-1"
            style={{ borderRadius: 2 }}
          />
        </div>

        {rows.length > 0 && (
          <div className="space-y-2">
            <div className="text-[9px] uppercase tracking-wide text-fg-muted">
              Corrections
            </div>
            {rows.map((t) => {
              const original = osmTags[t.key] === undefined || osmTags[t.key] === null
                ? '' : String(osmTags[t.key]);
              return (
                <div key={t.key}>
                  <label htmlFor={`osm-f-${t.key}`} className="block text-[9px] text-fg-muted mb-0.5">
                    {t.label}
                    {original && <span className="text-fg-muted"> · OSM: {original}</span>}
                  </label>
                  <input
                    id={`osm-f-${t.key}`}
                    value={fields[t.key] ?? ''}
                    onChange={(e) => setFields((p) => ({ ...p, [t.key]: e.target.value }))}
                    placeholder={original || t.placeholder}
                    className="w-full bg-surface-sunken border border-border-default text-[11px] text-rmpg-100 px-2 py-1"
                    style={{ borderRadius: 2 }}
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-[11px] text-rmpg-100 cursor-pointer">
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
            <span>Verified on the ground by RMPG</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-rmpg-100 cursor-pointer">
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
            <span className="flex items-center gap-1">
              <EyeOff size={11} /> Hide from the map
            </span>
          </label>
          {hidden && (
            <div className="text-[9px] text-fg-muted leading-snug">
              Hides it for every RMPG user. The OpenStreetMap record is not deleted.
            </div>
          )}
        </div>

        {error && (
          <div className="text-[10px] text-[color:var(--sev-critical)]" role="alert">{error}</div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-border-default flex-none">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-brand-600 text-rmpg-100 disabled:opacity-50"
          style={{ borderRadius: 2 }}
        >
          <Check size={12} /> {busy ? 'Saving…' : 'Save'}
        </button>
        {existing && (
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-fg-secondary disabled:opacity-50"
            style={{ borderRadius: 2 }}
          >
            <Trash2 size={12} /> Remove override
          </button>
        )}
        <a
          href={`https://www.openstreetmap.org/${osmType}/${osmId.slice(1)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-[9px] text-fg-muted"
        >
          {osmId} <ExternalLink size={9} />
        </a>
      </div>
    </div>
  );
}
