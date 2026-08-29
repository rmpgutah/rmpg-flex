// ============================================================
// RMPG Flex — Dispatch Geography Admin Page
//
// 4-column Miller drilldown: Areas → Sectors → Zones → Beats
// Right-side detail pane with view/edit/create + delete actions.
// Spillman day/night theme via tokens — no hardcoded hex except
// the audited brand-gold accent (resolved via brand-gold-500).
//
// URL deep-link contract (Page 35 of the full-app frontend pass):
//   ?area_id=N      — auto-select an Area (selects, strips param)
//   ?sector_id=N    — auto-select a Sector + its Area
//   ?zone_id=N      — auto-select a Zone + its Sector + Area
//   ?beat_id=N      — auto-select a Beat + Zone + Sector + Area
// Mirrors the contract every other audited page uses (Trespass
// Orders / Fleet / Communications / Serve …). Consumed once and
// stripped (replace:true) so a hard refresh doesn't re-pin to a
// stale deep-link.
//
// Phase 3 of the geography rebuild plan. Full spec in
// docs/plans/2026-04-10-geography-areas-sectors-zones-beats-design.md
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download, Edit2, MapPin, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useGeographyTree } from '../hooks/useGeographyTree';
import { useFormDraft } from '../hooks/useFormDraft';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import FloatingSaveBar from '../components/FloatingSaveBar';
import ConfirmDialog from '../components/ConfirmDialog';
import type { Area, Beat, Sector, TierId, Zone } from '../types/geography';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import { downloadTextFile, geoLayersToCsv } from '../utils/rmsListExport';
import { useSlashFocus } from '../hooks/useSlashFocus';

// ── Types ────────────────────────────────────────────────────

type SelectedItem =
  | { tier: 'area'; data: Area }
  | { tier: 'sector'; data: Sector }
  | { tier: 'zone'; data: Zone }
  | { tier: 'beat'; data: Beat }
  | null;

interface PageState {
  selectedAreaId: number | null;
  selectedSectorId: number | null;
  selectedZoneId: number | null;
  selectedBeatId: number | null;
  searchQuery: string;
}

const INITIAL_STATE: PageState = {
  selectedAreaId: null,
  selectedSectorId: null,
  selectedZoneId: null,
  selectedBeatId: null,
  searchQuery: '',
};

// ── Per-user storage scoping ─────────────────────────────────
//
// useFormDraft persists per `storageKey`, and the original keys here
// (rmpg_geo_*_form) were unscoped — shared across every operator on a
// single MDT (dispatch ↔ patrol ↔ supervisor share workstations).
// Without the suffix the last operator's draft clobbered the next
// one's edit, including a half-typed code/name from a different shift.
//
// We append `_<user.id>` per-user. A one-time read-through migration
// copies any existing bare-key draft over to the scoped key on first
// mount per user, so existing in-flight edits aren't lost when this
// ships. Pattern mirrors fleet-v2 InsightsRoute (PR #1626, SW v1041).
const GEO_FORM_BASE: Record<TierId, string> = {
  area:   'rmpg_geo_area_form',
  sector: 'rmpg_geo_sector_form',
  zone:   'rmpg_geo_zone_form',
  beat:   'rmpg_geo_beat_form',
};
function geoFormKey(tier: TierId, userId: string | number | undefined): string {
  return userId != null ? `${GEO_FORM_BASE[tier]}_${userId}` : GEO_FORM_BASE[tier];
}
function migrateGeoDraftKey(tier: TierId, userId: string | number | undefined): void {
  if (userId == null) return;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const scoped = geoFormKey(tier, userId);
    if (window.localStorage.getItem(scoped) != null) return;
    const bare = GEO_FORM_BASE[tier];
    const raw = window.localStorage.getItem(bare);
    if (raw == null) return;
    window.localStorage.setItem(scoped, raw);
    // Intentionally leave the bare key in place — other workstations on
    // the same browser profile would lose their draft if we cleared it
    // here. The bare key falls out of use as each user's first session
    // migrates.
  } catch {
    // quota / private mode — silent
  }
}

// ── Main component ───────────────────────────────────────────

export default function GeographyPage() {
  const { tree, loading, error, refetch } = useGeographyTree();
  const [state, setState] = useState<PageState>(INITIAL_STATE);
  const { addToast } = useToast();
  const { user } = useAuth();
  const userId = user?.id;
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  // Role gate: admin / manager / supervisor may create, edit, and delete
  // geography tiers. Officers and dispatchers get read-only access.
  const CAN_WRITE_ROLES = new Set(['admin', 'manager', 'supervisor']);
  const canWrite = CAN_WRITE_ROLES.has(user?.role ?? '');

  // ── Editing state ──
  const [editing, setEditing] = useState<TierId | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Add-tier dialog state (replaces window.prompt) ──
  const [addingTier, setAddingTier] = useState<TierId | null>(null);
  const [addName, setAddName] = useState('');
  const [addingSaving, setAddingSaving] = useState(false);

  // ── Delete confirmation dialog state (replaces window.confirm) ──
  const [deletePending, setDeletePending] = useState<SelectedItem>(null);
  const [deleting, setDeleting] = useState(false);

  // One-time migration of any bare-key drafts → scoped key for this user.
  // Runs once per userId; useFormDraft below reads from the scoped key.
  useEffect(() => {
    if (userId == null) return;
    migrateGeoDraftKey('area', userId);
    migrateGeoDraftKey('sector', userId);
    migrateGeoDraftKey('zone', userId);
    migrateGeoDraftKey('beat', userId);
  }, [userId]);

  // ── Per-tier form drafts (per-user scoped storageKey) ──
  const a = useFormDraft<Partial<Area>>({
    storageKey: geoFormKey('area', userId),
    defaultValue: {},
    isActive: editing === 'area',
  });
  const s = useFormDraft<Partial<Sector>>({
    storageKey: geoFormKey('sector', userId),
    defaultValue: {},
    isActive: editing === 'sector',
  });
  const z = useFormDraft<Partial<Zone>>({
    storageKey: geoFormKey('zone', userId),
    defaultValue: {},
    isActive: editing === 'zone',
  });
  const b = useFormDraft<Partial<Beat>>({
    storageKey: geoFormKey('beat', userId),
    defaultValue: {},
    isActive: editing === 'beat',
  });

  // Snapshot after form has been populated (render has completed)
  useEffect(() => {
    if (editing === 'area') a.snapshot();
    if (editing === 'sector') s.snapshot();
    if (editing === 'zone') z.snapshot();
    if (editing === 'beat') b.snapshot();
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived: items per column based on selection + search ──

  const matchesSearch = useCallback(
    (text: string) => {
      const q = state.searchQuery.toLowerCase().trim();
      if (!q) return true;
      return text.toLowerCase().includes(q);
    },
    [state.searchQuery],
  );

  const currentAreas: Area[] = useMemo(() => {
    const areas = tree?.areas || [];
    if (!state.searchQuery.trim()) return areas;
    return areas.filter((a) => matchesSearch(a.area_name + ' ' + a.area_code));
  }, [tree, state.searchQuery, matchesSearch]);

  const currentSectors: Sector[] = useMemo(() => {
    if (!tree || state.selectedAreaId == null) return [];
    const area = tree.areas.find((a) => a.id === state.selectedAreaId);
    const sectors = area?.sectors || [];
    if (!state.searchQuery.trim()) return sectors;
    return sectors.filter((s) => matchesSearch(s.sector_name + ' ' + s.sector_code));
  }, [tree, state.selectedAreaId, state.searchQuery, matchesSearch]);

  const currentZones: Zone[] = useMemo(() => {
    if (!tree || state.selectedSectorId == null) return [];
    for (const area of tree.areas) {
      const sector = area.sectors.find((s) => s.id === state.selectedSectorId);
      if (sector) {
        const zones = sector.zones || [];
        if (!state.searchQuery.trim()) return zones;
        return zones.filter((z) => matchesSearch(z.zone_name + ' ' + z.zone_code));
      }
    }
    return [];
  }, [tree, state.selectedSectorId, state.searchQuery, matchesSearch]);

  const currentBeats: Beat[] = useMemo(() => {
    if (!tree || state.selectedZoneId == null) return [];
    for (const area of tree.areas) {
      for (const sector of area.sectors) {
        const zone = sector.zones?.find((z) => z.id === state.selectedZoneId);
        if (zone) {
          const beats = zone.beats || [];
          if (!state.searchQuery.trim()) return beats;
          return beats.filter((b) => matchesSearch(b.beat_name + ' ' + b.beat_code));
        }
      }
    }
    return [];
  }, [tree, state.selectedZoneId, state.searchQuery, matchesSearch]);

  // ── Selection cascade ──

  const selectArea = useCallback((id: number) => {
    setState((s) => ({
      ...s,
      selectedAreaId: id,
      selectedSectorId: null,
      selectedZoneId: null,
      selectedBeatId: null,
    }));
  }, []);

  const selectSector = useCallback((id: number) => {
    setState((s) => ({
      ...s,
      selectedSectorId: id,
      selectedZoneId: null,
      selectedBeatId: null,
    }));
  }, []);

  const selectZone = useCallback((id: number) => {
    setState((s) => ({ ...s, selectedZoneId: id, selectedBeatId: null }));
  }, []);

  const selectBeat = useCallback((id: number) => {
    setState((s) => ({ ...s, selectedBeatId: id }));
  }, []);

  // ── Resolve selected item for DetailPane ──

  const selected: SelectedItem = useMemo(() => {
    if (!tree) return null;
    if (state.selectedBeatId != null) {
      for (const a of tree.areas)
        for (const s of a.sectors)
          for (const z of s.zones || [])
            for (const b of z.beats || [])
              if (b.id === state.selectedBeatId) return { tier: 'beat', data: b };
    }
    if (state.selectedZoneId != null) {
      for (const a of tree.areas)
        for (const s of a.sectors)
          for (const z of s.zones || [])
            if (z.id === state.selectedZoneId) return { tier: 'zone', data: z };
    }
    if (state.selectedSectorId != null) {
      for (const a of tree.areas)
        for (const s of a.sectors || [])
          if (s.id === state.selectedSectorId) return { tier: 'sector', data: s };
    }
    if (state.selectedAreaId != null) {
      const a = tree.areas.find((x) => x.id === state.selectedAreaId);
      if (a) return { tier: 'area', data: a };
    }
    return null;
  }, [tree, state]);

  // ── Add handlers (tier-specific) ──
  //
  // Old version threw a native window.prompt() — Spillman-styled pages
  // never use system dialogs (no body-scroll lock, no kbd contract, no
  // theming). Replaced with an in-page ConfirmDialog that pre-focuses
  // the name input, supports Esc cancel, and shows the parent context
  // ("creating under Sector X") so a misclick is obvious before save.

  const openAdd = useCallback(
    (tier: TierId) => {
      if (tier === 'sector' && state.selectedAreaId == null) {
        addToast('Select an Area first', 'error');
        return;
      }
      if (tier === 'zone' && state.selectedSectorId == null) {
        addToast('Select a Sector first', 'error');
        return;
      }
      if (tier === 'beat' && state.selectedZoneId == null) {
        addToast('Select a Zone first', 'error');
        return;
      }
      setAddName('');
      setAddingTier(tier);
    },
    [state.selectedAreaId, state.selectedSectorId, state.selectedZoneId, addToast],
  );

  const closeAdd = useCallback(() => {
    if (addingSaving) return;
    setAddingTier(null);
    setAddName('');
  }, [addingSaving]);

  const confirmAdd = useCallback(async () => {
    if (!addingTier) return;
    const trimmed = addName.trim();
    if (!trimmed) {
      addToast('Name is required', 'warning');
      return;
    }
    const tier = addingTier;
    const code = trimmed.toUpperCase().replace(/\s+/g, '_').slice(0, 12);
    setAddingSaving(true);
    try {
      if (tier === 'area') {
        await apiFetch('/dispatch/geography/areas', {
          method: 'POST',
          body: JSON.stringify({ area_code: code, area_name: trimmed }),
        });
      } else if (tier === 'sector') {
        await apiFetch('/dispatch/geography/sectors', {
          method: 'POST',
          body: JSON.stringify({
            sector_code: code,
            sector_name: trimmed,
            area_id: state.selectedAreaId,
          }),
        });
      } else if (tier === 'zone') {
        await apiFetch('/dispatch/geography/zones', {
          method: 'POST',
          body: JSON.stringify({
            zone_code: code,
            zone_name: trimmed,
            sector_id: state.selectedSectorId,
          }),
        });
      } else if (tier === 'beat') {
        await apiFetch('/dispatch/geography/beats', {
          method: 'POST',
          body: JSON.stringify({
            beat_code: code,
            beat_name: trimmed,
            zone_id: state.selectedZoneId,
          }),
        });
      }
      addToast(`${tier.charAt(0).toUpperCase() + tier.slice(1)} "${trimmed}" created`, 'success');
      setAddingTier(null);
      setAddName('');
      refetch();
    } catch (e) {
      addToast(`Create ${tier} failed: ${(e as Error)?.message || 'unknown error'}`, 'error');
    } finally {
      setAddingSaving(false);
    }
  }, [addingTier, addName, state.selectedAreaId, state.selectedSectorId, state.selectedZoneId, refetch, addToast]);

  // ── Delete handler (current selection) ──
  //
  // Replaces the old window.confirm() with ConfirmDialog. The dialog
  // shows tier + code + name so the operator sees exactly what they're
  // about to drop. We never delete in-flight — the body-scroll lock +
  // confirmDisabled-while-loading prevent the duplicate-fire race.

  const openDelete = useCallback(() => {
    if (!selected) return;
    setDeletePending(selected);
  }, [selected]);

  const closeDelete = useCallback(() => {
    if (deleting) return;
    setDeletePending(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!deletePending) return;
    const tier = deletePending.tier;
    const id = deletePending.data.id;
    const name =
      (deletePending.data as any).area_name ||
      (deletePending.data as any).sector_name ||
      (deletePending.data as any).zone_name ||
      (deletePending.data as any).beat_name ||
      'this item';

    const tierPath =
      tier === 'area'
        ? 'areas'
        : tier === 'sector'
          ? 'sectors'
          : tier === 'zone'
            ? 'zones'
            : 'beats';

    setDeleting(true);
    try {
      await apiFetch(`/dispatch/geography/${tierPath}/${id}`, { method: 'DELETE' });
      // Clear selection for the deleted tier + below
      setState((st) => {
        if (tier === 'area') return { ...st, selectedAreaId: null, selectedSectorId: null, selectedZoneId: null, selectedBeatId: null };
        if (tier === 'sector') return { ...st, selectedSectorId: null, selectedZoneId: null, selectedBeatId: null };
        if (tier === 'zone') return { ...st, selectedZoneId: null, selectedBeatId: null };
        return { ...st, selectedBeatId: null };
      });
      if (editing === tier) setEditing(null);
      setDeletePending(null);
      refetch();
      addToast(`Deleted ${tier} "${name}"`, 'success');
    } catch (e) {
      addToast(`Delete failed: ${(e as Error)?.message || 'unknown error'}`, 'error');
    } finally {
      setDeleting(false);
    }
  }, [deletePending, refetch, addToast, editing]);

  // ── Edit handlers ──

  const handleStartEdit = () => {
    if (!selected) return;
    const tier = selected.tier;
    const data = selected.data;
    if (tier === 'area') a.setForm(data as Partial<Area>);
    else if (tier === 'sector') s.setForm(data as Partial<Sector>);
    else if (tier === 'zone') z.setForm(data as Partial<Zone>);
    else if (tier === 'beat') b.setForm(data as Partial<Beat>);
    setEditing(tier);
  };

  const handleCancelEdit = useCallback(() => {
    if (editing === 'area') a.clearDraft();
    else if (editing === 'sector') s.clearDraft();
    else if (editing === 'zone') z.clearDraft();
    else if (editing === 'beat') b.clearDraft();
    setEditing(null);
  }, [editing, a.clearDraft, s.clearDraft, z.clearDraft, b.clearDraft]);

  const handleSaveEdit = useCallback(async () => {
    if (!selected || !editing || selected.tier !== editing) return;
    setSaving(true);

    const tier = editing;
    const id = selected.data.id;

    const formData: Record<string, any> =
      tier === 'area' ? { ...a.form } :
      tier === 'sector' ? { ...s.form } :
      tier === 'zone' ? { ...z.form } :
      { ...b.form };

    // Fields the server does NOT accept on PUT — strip before sending
    const EXCLUDE = new Set([
      'id', 'created_at', 'updated_at',
      'sectors', 'zones', 'beats',          // navigation children
      'sector_count', 'zone_count', 'beat_count', // computed counts
      'area_code', 'area_name',              // JOINed on sectors
      'sector_code', 'sector_name',          // JOINed on zones
      'zone_code', 'zone_name',              // JOINed on beats
      'area_id', 'sector_id', 'zone_id',     // parent FKs (contextual)
      'district_letter', 'beat_number',      // derived columns
      'county_nbr', 'fips_code',             // read-only GIS refs
      'ugrc_code',                           // read-only GIS ref
      'zone_type',                           // not in PUT fields list
      'premise_alerts',                      // not in PUT fields list
      'population_estimate',                  // not in PUT fields list (zone/beat)
      'sq_miles',                            // not in PUT fields list (zone/beat)
    ]);

    const payload: Record<string, any> = {};
    for (const [k, v] of Object.entries(formData)) {
      if (!EXCLUDE.has(k) && v !== undefined) {
        payload[k] = v;
      }
    }

    if (Object.keys(payload).length === 0) {
      addToast('No fields changed', 'warning');
      setSaving(false);
      return;
    }

    try {
      await apiFetch(`/dispatch/geography/${tier}s/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (tier === 'area') a.clearDraft();
      else if (tier === 'sector') s.clearDraft();
      else if (tier === 'zone') z.clearDraft();
      else if (tier === 'beat') b.clearDraft();
      setEditing(null);
      refetch();
      addToast(`${tier.charAt(0).toUpperCase() + tier.slice(1)} updated`, 'success');
    } catch (e) {
      addToast(`Save failed: ${(e as Error)?.message || 'unknown error'}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [selected, editing, a, s, z, b, refetch, addToast]);

  // ── Derived form state for the active editing tier ──
  const activeEditForm = useMemo((): Record<string, any> => {
    if (editing === 'area') return a.form as Record<string, any>;
    if (editing === 'sector') return s.form as Record<string, any>;
    if (editing === 'zone') return z.form as Record<string, any>;
    if (editing === 'beat') return b.form as Record<string, any>;
    return {};
  }, [editing, a.form, s.form, z.form, b.form]);

  const setActiveEditField = useCallback((field: string, value: any) => {
    if (editing === 'area') a.setForm((prev: any) => ({ ...prev, [field]: value }));
    else if (editing === 'sector') s.setForm((prev: any) => ({ ...prev, [field]: value }));
    else if (editing === 'zone') z.setForm((prev: any) => ({ ...prev, [field]: value }));
    else if (editing === 'beat') b.setForm((prev: any) => ({ ...prev, [field]: value }));
  }, [editing, a.setForm, s.setForm, z.setForm, b.setForm]);

  // ── Combined dirty state ──
  const isAnyDirty = a.isDirty || s.isDirty || z.isDirty || b.isDirty;

  // ── Keyboard: Esc smart-cascade, / focuses search, N adds at focused tier ──
  //
  // Esc cascade (top-down) so each press unwinds exactly one layer of
  // operator state, matching ServePage / Trespass / DAR / Fleet pattern:
  //   1. delete confirmation open → close dialog
  //   2. add confirmation open    → close dialog
  //   3. editing in detail pane   → cancel edit
  //   4. tier search active       → clear search
  //   5. anything selected        → clear selection cascade
  // Each branch returns so a single Esc never collapses two layers.
  //
  // N adds at the deepest selected tier (or Area if nothing is
  // selected). Suppressed while any dialog or input is focused so a
  // recipient name with "n" in it doesn't pop the dialog mid-type.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deletePending) { closeDelete(); return; }
        if (addingTier)    { closeAdd();    return; }
        if (editing)       { handleCancelEdit(); return; }
        if (state.searchQuery) {
          setState((st) => ({ ...st, searchQuery: '' }));
          return;
        }
        if (
          state.selectedBeatId != null ||
          state.selectedZoneId != null ||
          state.selectedSectorId != null ||
          state.selectedAreaId != null
        ) {
          setState(INITIAL_STATE);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (deletePending || addingTier) return;
      if (e.key === '/') {
        e.preventDefault();
        (document.getElementById('geography-search-input') as HTMLInputElement)?.focus();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        if (!canWrite) return;
        // Deepest selected tier wins so the operator gets the new row
        // exactly where their attention is (cursor-down-the-tree UX).
        e.preventDefault();
        const targetTier: TierId =
          state.selectedZoneId != null ? 'beat' :
          state.selectedSectorId != null ? 'zone' :
          state.selectedAreaId != null ? 'sector' :
          'area';
        openAdd(targetTier);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    deletePending, addingTier, editing, handleCancelEdit,
    state.searchQuery, state.selectedAreaId, state.selectedSectorId,
    state.selectedZoneId, state.selectedBeatId, closeDelete, closeAdd, openAdd, canWrite,
  ]);

  // ── URL deep-link: ?area_id=&sector_id=&zone_id=&beat_id= ──
  //
  // Same shape every other audited page uses (Trespass / Fleet /
  // Communications / Serve). Runs once after the tree hydrates: looks
  // up the ids and selects the deepest tier present, walking up to
  // also select all its ancestors so the column drilldown is correct.
  // Strips the params (replace:true) afterwards so a hard refresh
  // doesn't re-pin the operator to a stale link.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingDeepLinkRef = useRef<{
    area: string | null;
    sector: string | null;
    zone: string | null;
    beat: string | null;
  } | null>({
    area:   searchParams.get('area_id'),
    sector: searchParams.get('sector_id'),
    zone:   searchParams.get('zone_id'),
    beat:   searchParams.get('beat_id'),
  });
  useEffect(() => {
    const pending = pendingDeepLinkRef.current;
    if (!pending || !tree) return;
    const hasAny = pending.area || pending.sector || pending.zone || pending.beat;
    if (!hasAny) {
      pendingDeepLinkRef.current = null;
      return;
    }
    // Walk the tree to find the deepest target + ancestors
    let nextState: PageState = { ...INITIAL_STATE };
    let matched = false;
    let unresolved: string | null = null;

    const beatTarget = pending.beat ? Number(pending.beat) : null;
    const zoneTarget = pending.zone ? Number(pending.zone) : null;
    const sectorTarget = pending.sector ? Number(pending.sector) : null;
    const areaTarget = pending.area ? Number(pending.area) : null;

    for (const area of tree.areas) {
      for (const sector of area.sectors || []) {
        for (const zone of sector.zones || []) {
          for (const beat of zone.beats || []) {
            if (beatTarget != null && beat.id === beatTarget) {
              nextState = {
                selectedAreaId: area.id,
                selectedSectorId: sector.id,
                selectedZoneId: zone.id,
                selectedBeatId: beat.id,
                searchQuery: '',
              };
              matched = true;
            }
          }
          if (!matched && zoneTarget != null && zone.id === zoneTarget) {
            nextState = {
              selectedAreaId: area.id,
              selectedSectorId: sector.id,
              selectedZoneId: zone.id,
              selectedBeatId: null,
              searchQuery: '',
            };
            matched = true;
          }
        }
        if (!matched && sectorTarget != null && sector.id === sectorTarget) {
          nextState = {
            selectedAreaId: area.id,
            selectedSectorId: sector.id,
            selectedZoneId: null,
            selectedBeatId: null,
            searchQuery: '',
          };
          matched = true;
        }
      }
      if (!matched && areaTarget != null && area.id === areaTarget) {
        nextState = {
          selectedAreaId: area.id,
          selectedSectorId: null,
          selectedZoneId: null,
          selectedBeatId: null,
          searchQuery: '',
        };
        matched = true;
      }
    }
    if (matched) {
      setState(nextState);
    } else {
      unresolved =
        beatTarget ? `beat ${beatTarget}` :
        zoneTarget ? `zone ${zoneTarget}` :
        sectorTarget ? `sector ${sectorTarget}` :
        areaTarget ? `area ${areaTarget}` :
        null;
      if (unresolved) addToast(`Could not find ${unresolved}`, 'warning');
    }

    // Strip the params so a refresh doesn't re-pin
    const next = new URLSearchParams(searchParams);
    next.delete('area_id');
    next.delete('sector_id');
    next.delete('zone_id');
    next.delete('beat_id');
    setSearchParams(next, { replace: true });
    pendingDeepLinkRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  // ── CSV export — flat hierarchy snapshot ─────────────────────
  //
  // Geography rarely changes day-to-day but downstream paperwork
  // (call-sign assignments, supervisor rosters, MOU exhibits) wants a
  // single sortable sheet that maps every beat back up to its zone /
  // sector / area + key dispatch attributes. Browser-side blob → no
  // round trip; filename carries the Denver-local date so successive
  // pulls don't clobber each other in /Downloads.
  const handleExportCsv = useCallback(() => {
    if (!tree) return;
    const headers = [
      'tier',
      'area_code', 'area_name',
      'sector_code', 'sector_name',
      'zone_code', 'zone_name', 'zone_type',
      'beat_code', 'beat_name', 'dispatch_code',
      'primary_unit', 'backup_unit', 'assigned_unit',
      'radio_channel',
      'population_estimate', 'sq_miles',
      'active',
    ];
    const escape = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows: string[] = [headers.join(',')];
    let total = 0;
    for (const area of tree.areas) {
      // Area row (so areas with no children still show up)
      rows.push(
        [
          'area',
          area.area_code, area.area_name,
          '', '',
          '', '', '',
          '', '', '',
          '', '', '',
          '',
          '', '',
          area.active,
        ].map(escape).join(','),
      );
      total++;
      for (const sector of area.sectors || []) {
        rows.push(
          [
            'sector',
            area.area_code, area.area_name,
            sector.sector_code, sector.sector_name,
            '', '', '',
            '', '', '',
            '', '', '',
            sector.radio_channel,
            '', '',
            sector.active,
          ].map(escape).join(','),
        );
        total++;
        for (const zone of sector.zones || []) {
          rows.push(
            [
              'zone',
              area.area_code, area.area_name,
              sector.sector_code, sector.sector_name,
              zone.zone_code, zone.zone_name, zone.zone_type,
              '', '', '',
              zone.primary_unit, zone.backup_unit, '',
              zone.radio_channel,
              zone.population_estimate, zone.sq_miles,
              zone.active,
            ].map(escape).join(','),
          );
          total++;
          for (const beat of zone.beats || []) {
            rows.push(
              [
                'beat',
                area.area_code, area.area_name,
                sector.sector_code, sector.sector_name,
                zone.zone_code, zone.zone_name, zone.zone_type,
                beat.beat_code, beat.beat_name, beat.dispatch_code,
                '', beat.backup_unit, beat.assigned_unit,
                '',
                beat.population_estimate, beat.sq_miles,
                beat.active,
              ].map(escape).join(','),
            );
            total++;
          }
        }
      }
    }
    try {
      const csv = rows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      // Denver-local YYYY-MM-DD on the filename so daily snapshots
      // don't shadow each other in the downloads folder.
      const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
      const link = document.createElement('a');
      link.href = url;
      link.download = `dispatch_geography_${stamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      addToast(`Exported ${total} row${total === 1 ? '' : 's'}`, 'success');
    } catch (e) {
      addToast(`Export failed: ${(e as Error)?.message || 'unknown error'}`, 'error');
    }
  }, [tree, addToast]);

  // ── Render ──

  if (loading && !tree) {
    return (
      <div className="p-4">
        <PanelTitleBar title="DISPATCH GEOGRAPHY" icon={MapPin} />
        <div className="panel-raised p-6 text-center text-[var(--text-muted)] text-sm">
          Loading geography tree…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <PanelTitleBar title="DISPATCH GEOGRAPHY" icon={MapPin} />
        <div className="panel-raised p-6 text-center">
          <p className="text-red-400 text-sm">{error}</p>
          <button type="button"
            onClick={refetch}
            className="mt-3 toolbar-btn"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const sectorCount = tree?.areas.flatMap((a) => a.sectors || []).length || 0;
  const zoneCount = tree?.areas.flatMap((a) => a.sectors || []).flatMap((s) => s.zones || []).length || 0;
  const beatCount =
    tree?.areas
      .flatMap((a) => a.sectors || [])
      .flatMap((s) => s.zones || [])
      .flatMap((z) => z.beats || []).length || 0;

  return (
    <div className="p-4 flex flex-col h-full gap-2 min-h-0">
      <UnsavedChangesGuard hasUnsavedChanges={isAnyDirty} />
      <FloatingSaveBar
        visible={isAnyDirty}
        onSave={handleSaveEdit}
        onCancel={handleCancelEdit}
        isSaving={saving}
        saveLabel="Save"
      />

      <PanelTitleBar
        title="DISPATCH GEOGRAPHY — AREAS / SECTORS / ZONES / BEATS"
        icon={MapPin}
      >
        <button
          type="button"
          className="toolbar-btn"
          disabled={!tree}
          onClick={() => downloadTextFile('geography-layers.csv', geoLayersToCsv([
            ...currentAreas.map((a) => ({ id: String(a.id), name: a.area_name, type: 'area', visible: state.selectedAreaId === a.id })),
            ...currentSectors.map((s) => ({ id: String(s.id), name: s.sector_name, type: 'sector', visible: state.selectedSectorId === s.id })),
            ...currentZones.map((z) => ({ id: String(z.id), name: z.zone_name, type: 'zone', visible: state.selectedZoneId === z.id })),
            ...currentBeats.map((b) => ({ id: String(b.id), name: b.beat_name, type: 'beat', visible: state.selectedBeatId === b.id })),
          ]))}
        >CSV</button>
      </PanelTitleBar>

      {/* Search + refresh + export bar */}
      <div className="flex items-center gap-2 px-2">
        <input
          id="geography-search-input"
          ref={searchRef}
          type="text"
          value={state.searchQuery}
          onChange={(e) => setState((s) => ({ ...s, searchQuery: e.target.value }))}
          placeholder="Search all tiers… (press / to focus)"
          aria-label="Search geography tiers"
          className="input-dark text-xs flex-1 max-w-md"
        />
        {state.searchQuery && (
          <button type="button"
            onClick={() => setState((s) => ({ ...s, searchQuery: '' }))}
            className="p-1 text-[var(--text-muted)] hover:text-brand-gold-500"
            title="Clear search"
          >
            <X size={14} />
          </button>
        )}
        <button type="button"
          onClick={refetch}
          className="p-1.5 text-[var(--text-muted)] hover:text-brand-gold-500"
          title="Refetch from server"
        >
          <RefreshCw size={12} />
        </button>
        <button type="button"
          onClick={handleExportCsv}
          disabled={!tree || (tree?.areas.length || 0) === 0}
          className="p-1.5 text-[var(--text-muted)] hover:text-brand-gold-500 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Download flat geography CSV (court-ready hierarchy snapshot)"
        >
          <Download size={12} />
        </button>
      </div>

      {/* Columns */}
      <div className="flex-1 flex gap-0 min-h-0 panel-raised border border-border-default">
        <TierColumn<Area>
          title="AREAS"
          count={currentAreas.length}
          items={currentAreas}
          selectedId={state.selectedAreaId}
          onSelect={selectArea}
          onAdd={() => openAdd('area')}
          canAdd={canWrite}
          renderItem={(a) => ({
            primary: a.area_name,
            secondary: a.sector_count != null ? `${a.sector_count} sectors` : '',
            code: a.area_code,
          })}
          width={180}
        />
        <TierColumn<Sector>
          title={`SECTORS ${currentSectors.length > 0 ? `(${currentSectors.length})` : ''}`}
          count={currentSectors.length}
          items={currentSectors}
          selectedId={state.selectedSectorId}
          onSelect={selectSector}
          onAdd={() => openAdd('sector')}
          canAdd={canWrite}
          disabled={state.selectedAreaId == null}
          renderItem={(s) => ({
            primary: s.sector_name,
            secondary: s.zone_count != null ? `${s.zone_count} zones` : '',
            code: s.sector_code,
          })}
          width={200}
        />
        <TierColumn<Zone>
          title={`ZONES ${currentZones.length > 0 ? `(${currentZones.length})` : ''}`}
          count={currentZones.length}
          items={currentZones}
          selectedId={state.selectedZoneId}
          onSelect={selectZone}
          onAdd={() => openAdd('zone')}
          canAdd={canWrite}
          disabled={state.selectedSectorId == null}
          renderItem={(z) => ({
            primary: z.zone_name,
            secondary: z.zone_type === 'unincorporated' ? 'Unincorp.' : '',
            code: z.zone_code,
          })}
          width={240}
        />
        <TierColumn<Beat>
          title={`BEATS ${currentBeats.length > 0 ? `(${currentBeats.length})` : ''}`}
          count={currentBeats.length}
          items={currentBeats}
          selectedId={state.selectedBeatId}
          onSelect={selectBeat}
          onAdd={() => openAdd('beat')}
          canAdd={canWrite}
          disabled={state.selectedZoneId == null}
          renderItem={(b) => ({
            primary: b.beat_name,
            secondary: b.dispatch_code || b.beat_code,
            code: b.beat_code,
          })}
          width={240}
        />
        <DetailPane
          selected={selected}
          onDelete={openDelete}
          editing={editing}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onSaveEdit={handleSaveEdit}
          editForm={activeEditForm}
          onEditFieldChange={setActiveEditField}
          saving={saving}
          canWrite={canWrite}
        />
      </div>

      {/* Stats bar */}
      <div className="panel-sunken px-4 py-2 text-[10px] text-[var(--text-muted)] flex gap-6 border border-border-default">
        <span>
          <span className="text-brand-gold-500 font-bold">{tree?.areas.length || 0}</span> AREAS
        </span>
        <span>
          <span className="text-brand-gold-500 font-bold">{sectorCount}</span> SECTORS
        </span>
        <span>
          <span className="text-brand-gold-500 font-bold">{zoneCount}</span> ZONES
        </span>
        <span>
          <span className="text-brand-gold-500 font-bold">{beatCount}</span> BEATS
        </span>
        <span className="ml-auto text-[9px] opacity-60">
          ↑↓ select · / search · N new · Esc cascade
        </span>
      </div>

      {/* ── Add-tier dialog (replaces window.prompt) ── */}
      <ConfirmDialog
        isOpen={!!addingTier}
        onClose={closeAdd}
        onConfirm={confirmAdd}
        title={addingTier ? `New ${addingTier.charAt(0).toUpperCase()}${addingTier.slice(1)}` : ''}
        message="Enter a display name. A 12-character code is auto-derived (uppercase, underscores) and can be renamed later from the detail pane."
        details={
          <>
            <div className="mt-1">
              <label className="block text-[9px] uppercase tracking-wider text-rmpg-500 mb-1">
                {addingTier ? `${addingTier.charAt(0).toUpperCase()}${addingTier.slice(1)} name` : 'Name'}
              </label>
              <input
                autoFocus
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !addingSaving) {
                    e.preventDefault();
                    confirmAdd();
                  }
                }}
                className="input-dark text-[12px] w-full"
                placeholder={
                  addingTier === 'area' ? 'e.g. Salt Lake Valley' :
                  addingTier === 'sector' ? 'e.g. North Valley' :
                  addingTier === 'zone' ? 'e.g. Downtown' :
                  'e.g. Beat 1'
                }
                maxLength={120}
              />
            </div>
            {addingTier === 'sector' && state.selectedAreaId != null && (
              <div className="mt-2 text-[10px]">
                <span className="text-rmpg-500">Parent Area</span>{' '}
                <span className="text-rmpg-100 font-mono">
                  {tree?.areas.find((x) => x.id === state.selectedAreaId)?.area_code || `#${state.selectedAreaId}`}
                </span>
              </div>
            )}
            {addingTier === 'zone' && state.selectedSectorId != null && (
              <div className="mt-2 text-[10px]">
                <span className="text-rmpg-500">Parent Sector</span>{' '}
                <span className="text-rmpg-100 font-mono">
                  {(() => {
                    for (const a of tree?.areas || [])
                      for (const s of a.sectors || [])
                        if (s.id === state.selectedSectorId) return s.sector_code;
                    return `#${state.selectedSectorId}`;
                  })()}
                </span>
              </div>
            )}
            {addingTier === 'beat' && state.selectedZoneId != null && (
              <div className="mt-2 text-[10px]">
                <span className="text-rmpg-500">Parent Zone</span>{' '}
                <span className="text-rmpg-100 font-mono">
                  {(() => {
                    for (const a of tree?.areas || [])
                      for (const s of a.sectors || [])
                        for (const z of s.zones || [])
                          if (z.id === state.selectedZoneId) return z.zone_code;
                    return `#${state.selectedZoneId}`;
                  })()}
                </span>
              </div>
            )}
          </>
        }
        confirmLabel={addingSaving ? 'Creating…' : 'Create'}
        confirmVariant="default"
        confirmDisabled={!addName.trim()}
        isLoading={addingSaving}
      />

      {/* ── Delete confirmation dialog (replaces window.confirm) ── */}
      <ConfirmDialog
        isOpen={!!deletePending}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        title={deletePending ? `Delete ${deletePending.tier}?` : ''}
        message="This permanently removes the row from dispatch geography. Children below this tier may end up orphaned — verify there are no live calls or units referencing it first."
        details={
          deletePending ? (
            <>
              <div>
                <span className="text-rmpg-500">Tier</span>{' '}
                <span className="text-rmpg-100 capitalize">{formatEnumValue(deletePending.tier)}</span>
              </div>
              <div>
                <span className="text-rmpg-500">Code</span>{' '}
                <span className="font-mono text-rmpg-100">
                  {(deletePending.data as any).area_code ||
                    (deletePending.data as any).sector_code ||
                    (deletePending.data as any).zone_code ||
                    (deletePending.data as any).beat_code}
                </span>
              </div>
              <div>
                <span className="text-rmpg-500">Name</span>{' '}
                <span className="text-rmpg-100">
                  {(deletePending.data as any).area_name ||
                    (deletePending.data as any).sector_name ||
                    (deletePending.data as any).zone_name ||
                    (deletePending.data as any).beat_name}
                </span>
              </div>
            </>
          ) : undefined
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}

// ── TierColumn (reusable) ────────────────────────────────────

interface TierColumnProps<T extends { id: number }> {
  title: string;
  count: number;
  items: T[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
  /** False for read-only roles (officer / dispatcher) — hides the + button. */
  canAdd?: boolean;
  disabled?: boolean;
  renderItem: (item: T) => { primary: string; secondary: string; code: string };
  width: number;
}

function TierColumn<T extends { id: number }>(props: TierColumnProps<T>) {
  return (
    <div
      className="border-r border-border-default flex flex-col min-h-0 bg-[var(--surface-raised)]"
      style={{ width: props.width, minWidth: props.width }}
    >
      <div className="px-3 py-2 border-b border-border-default bg-[var(--surface-sunken)] flex items-center justify-between">
        <span className="text-[10px] font-bold tracking-wider text-brand-gold-500 truncate">
          {props.title}
        </span>
        {props.canAdd !== false && (
          <button type="button"
            onClick={props.onAdd}
            disabled={props.disabled}
            className="p-1 hover:bg-surface-raised disabled:opacity-30 disabled:cursor-not-allowed"
            title={`Add new ${props.title.split(' ')[0].toLowerCase()}`}
          >
            <Plus size={12} className="text-[var(--text-muted)]" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {props.disabled ? (
          <div className="p-3 text-[10px] text-[var(--text-muted)] italic text-center">
            Select parent first
          </div>
        ) : props.items.length === 0 ? (
          <div className="p-3 text-[10px] text-[var(--text-muted)] italic text-center">
            (empty)
          </div>
        ) : (
          props.items.map((item) => {
            const { primary, secondary, code } = props.renderItem(item);
            const selected = item.id === props.selectedId;
            return (
              <button type="button"
                key={item.id}
                onClick={() => props.onSelect(item.id)}
                className={`w-full text-left px-3 py-2 border-l-2 text-[11px] ${
                  selected
                    ? 'border-brand-gold-500 bg-[var(--surface-hover)]'
                    : 'border-transparent hover:bg-surface-raised'
                }`}
              >
                <div className="font-semibold text-[var(--text-primary)] truncate">
                  {primary}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] truncate font-mono">
                    {code}
                  </span>
                  {secondary && (
                    <span className="text-[9px] text-[var(--text-muted)] whitespace-nowrap">
                      {secondary}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── DetailPane ───────────────────────────────────────────────

// Fields never shown (navigation children, timestamps, internal IDs)
const HIDDEN = new Set([
  'sectors', 'zones', 'beats',
  'created_at', 'updated_at',
  'id',
]);

// Fields shown read-only even in edit mode (parent FKs, computed, JOINed)
const READ_ONLY = new Set([
  'area_id', 'sector_id', 'zone_id',
  'area_code', 'area_name',
  'sector_code', 'sector_name',
  'zone_code', 'zone_name',
  'sector_count', 'zone_count', 'beat_count',
  'district_letter', 'beat_number',
  'county_nbr', 'fips_code',
  'ugrc_code',
]);

// Fields rendered as textareas instead of text inputs
const TEXTAREA_FIELDS = new Set([
  'description', 'notes', 'hazard_notes', 'premise_alerts',
]);

// Fields rendered as number inputs
const NUMBER_FIELDS = new Set([
  'sort_order', 'priority_modifier', 'population_estimate', 'sq_miles', 'beat_number',
]);

function DetailPane({
  selected,
  onDelete,
  editing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  editForm,
  onEditFieldChange,
  saving,
  canWrite,
}: {
  selected: SelectedItem;
  onDelete: () => void;
  editing: TierId | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  editForm: Record<string, any>;
  onEditFieldChange: (field: string, value: any) => void;
  saving: boolean;
  /** False for read-only roles — hides Edit and Delete buttons. */
  canWrite: boolean;
}) {
  if (!selected) {
    return (
      <div className="flex-1 p-6 flex items-center justify-center min-w-[280px]">
        <div className="text-center text-[var(--text-muted)] text-xs">
          <MapPin size={32} className="mx-auto mb-2 opacity-30" />
          <div>Select an item from any column</div>
          <div className="mt-1 text-[10px]">to see details</div>
        </div>
      </div>
    );
  }

  const data = selected.data as any;
  const tier = selected.tier;
  const isEditing = editing === tier;

  const primaryName =
    data.area_name || data.sector_name || data.zone_name || data.beat_name;
  const primaryCode =
    data.area_code || data.sector_code || data.zone_code || data.beat_code;

  const fields = Object.entries(isEditing ? editForm : data)
    .filter(([k]) => !HIDDEN.has(k))
    .filter(([k, v]) => v !== undefined);

  return (
    <div className="flex-1 p-4 overflow-y-auto min-w-[280px]">
      <div className="text-[10px] font-bold tracking-wider text-brand-gold-500 mb-2">
        {tier.toUpperCase()} DETAIL{isEditing ? ' (EDITING)' : ''}
      </div>
      <div className="text-[14px] font-bold text-[var(--text-primary)] mb-1">
        {primaryName}
      </div>
      <div className="text-[10px] text-[var(--text-muted)] font-mono mb-4">
        {primaryCode}
      </div>

      {isEditing ? (
        /* ── Edit mode: render form inputs ── */
        <div className="space-y-2 mb-6">
          {fields.map(([k, v]) => {
            const isReadOnly = READ_ONLY.has(k);
            const label = toDisplayLabel(k).toUpperCase();

            if (isReadOnly) {
              return (
                <div key={k} className="flex items-start gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] uppercase w-[110px] flex-shrink-0 pt-1">
                    {label}
                  </span>
                  <span className="text-[11px] text-[var(--text-primary)] break-words pt-1">
                    {v == null || v === '' ? (
                      <span className="text-[var(--text-muted)] italic">—</span>
                    ) : (
                      String(v)
                    )}
                  </span>
                </div>
              );
            }

            // Parent FK fields shown as read-only labels with the parent name
            if (k === 'active') {
              return (
                <label key={k} className="flex items-center gap-2 text-[11px]">
                  <input id="ff-geographypage-0"
                    type="checkbox"
                    checked={v == null ? true : Boolean(v)}
                    onChange={(e) => onEditFieldChange(k, e.target.checked ? 1 : 0)}
                    className="accent-brand-gold-500"
                  />
                  <span className="text-[var(--text-primary)]">{label}</span>
                </label>
              );
            }

            if (TEXTAREA_FIELDS.has(k)) {
              return (
                <div key={k} className="flex items-start gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] uppercase w-[110px] flex-shrink-0 pt-1">
                    {label}
                  </span>
                  <textarea id="ff-geographypage-1"
                    value={v == null ? '' : String(v)}
                    onChange={(e) => onEditFieldChange(k, e.target.value)}
                    className="input-dark text-[11px] flex-1 min-h-[48px] resize-y"
                    rows={2}
                  />
                </div>
              );
            }

            if (NUMBER_FIELDS.has(k)) {
              return (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] uppercase w-[110px] flex-shrink-0">
                    {label}
                  </span>
                  <input id="ff-geographypage-2"
                    type="number"
                    value={v == null ? '' : String(v)}
                    onChange={(e) => onEditFieldChange(k, e.target.value === '' ? null : Number(e.target.value))}
                    className="input-dark text-[11px] flex-1"
                  />
                </div>
              );
            }

            return (
              <div key={k} className="flex items-center gap-2">
                <span className="text-[9px] text-[var(--text-muted)] uppercase w-[110px] flex-shrink-0">
                  {label}
                </span>
                <input id="ff-geographypage-3"
                  type="text"
                  value={v == null ? '' : String(v)}
                  onChange={(e) => onEditFieldChange(k, e.target.value)}
                  className="input-dark text-[11px] flex-1"
                />
              </div>
            );
          })}
        </div>
      ) : (
        /* ── View mode: read-only field list ── */
        <dl className="text-[11px] grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 mb-6">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[var(--text-muted)] uppercase text-[9px] pt-0.5">
                {toDisplayLabel(k)}
              </dt>
              <dd className="text-[var(--text-primary)] break-words">
                {v == null || v === '' ? (
                  <span className="text-[var(--text-muted)] italic">—</span>
                ) : (
                  String(v)
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* Action buttons — write-gated (admin / manager / supervisor only) */}
      {canWrite && (
        <div className="flex gap-2">
          {isEditing ? (
            <button type="button"
              onClick={onSaveEdit}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] border border-brand-gold-500 bg-brand-gold-500/10 text-brand-gold-500 hover:bg-brand-gold-500/20 disabled:opacity-50"
            >
              <Save size={11} />
              Save
            </button>
          ) : (
            <button type="button"
              onClick={onStartEdit}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] border border-border-subtle hover:border-brand-gold-500 hover:bg-brand-gold-500/10 text-[var(--text-muted)] hover:text-brand-gold-500"
            >
              <Edit2 size={11} />
              Edit
            </button>
          )}
          <button type="button"
            onClick={isEditing ? onCancelEdit : onDelete}
            className="flex items-center gap-1 px-3 py-1.5 text-[10px] border border-border-subtle hover:border-red-400 hover:bg-red-900/20 text-[var(--text-muted)] hover:text-red-300"
          >
            <Trash2 size={11} />
            {isEditing ? 'Cancel' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}
