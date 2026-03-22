import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Settings,
  Plus,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  ChevronDown,
  Save,
  MapPin,
  Phone,
  FileText,
  ToggleLeft,
  ToggleRight,
  Car,
  Siren,
  Hash,
  Radio,
  Cog,
  Scale,
  Search,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { INCIDENT_TYPE_CODES, INCIDENT_TYPE_CATEGORIES, type IncidentCategory } from '../../utils/caseNumbers';
import { OffenseLevelBadge } from '../../components/StatuteLookup';
import type { User, Unit, UnitStatus } from '../../types';

// ============================================================
// Types (same as in AdminPage)
// ============================================================

interface ConfigItem {
  id: number;
  config_key: string;
  config_value: string;
  category: string;
  sort_order: number;
  is_active: number;
}

interface CallTemplate {
  id: number;
  name: string;
  incident_type: string;
  priority: string;
  description_template: string | null;
  default_notes: string | null;
  source: string;
  is_active: number;
  sort_order: number;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

interface PriorityConfig {
  level: string;
  label: string;
  color: string;
  target: string;
}

interface ZoneBeat {
  code: string;
  name: string;
  description: string;
}

interface UnitTypeConfig {
  type: string;
  label: string;
  color: string;
}

interface SystemSettings {
  agency_name: string;
  agency_ori: string;
  default_timezone: string;
  auto_archive_days: string;
  session_timeout_minutes: string;
  feature_bolos: string;
  feature_warrants: string;
  feature_fleet: string;
  feature_evidence: string;
  feature_patrol_checkpoints: string;
  [key: string]: string;
}

interface SecurityConfig {
  min_password_length: string;
  require_uppercase: string;
  require_numbers: string;
  require_special_chars: string;
  max_login_attempts: string;
  lockout_duration_minutes: string;
  max_active_sessions: string;
  password_expiry_days: string;
}

interface BrandingConfig {
  report_header_text: string;
  report_subheader_text: string;
  primary_color: string;
  accent_color: string;
  header_bg_color: string;
}

type SysSection = 'incident_types' | 'dispositions' | 'priorities' | 'call_sources' | 'unit_types' | 'units' | 'zones' | 'templates' | 'evidence_types' | 'criminal_codes' | 'security' | 'branding' | 'settings';

// ============================================================
// Defaults
// ============================================================

const DEFAULT_PRIORITIES: PriorityConfig[] = [
  { level: 'P1', label: 'Emergency', color: '#dc2626', target: '< 3 min' },
  { level: 'P2', label: 'Urgent', color: '#f59e0b', target: '< 5 min' },
  { level: 'P3', label: 'Routine', color: '#3b82f6', target: '< 10 min' },
  { level: 'P4', label: 'Scheduled', color: '#6b7280', target: 'Scheduled' },
];

const DEFAULT_CALL_SOURCES = ['phone', 'radio', 'walk_in', 'alarm', 'patrol', 'online', 'dispatch', 'email', 'servemanager', 'other'];

const DEFAULT_UNIT_TYPES: UnitTypeConfig[] = [
  { type: 'patrol', label: 'Patrol', color: '#3b82f6' },
  { type: 'supervisor', label: 'Supervisor', color: '#f59e0b' },
  { type: 'k9', label: 'K9', color: '#8b5cf6' },
  { type: 'medical', label: 'Medical', color: '#ef4444' },
  { type: 'bike', label: 'Bike Patrol', color: '#10b981' },
  { type: 'foot', label: 'Foot Patrol', color: '#6366f1' },
  { type: 'vehicle', label: 'Vehicle', color: '#64748b' },
];

const DEFAULT_EVIDENCE_TYPES = [
  'physical', 'documentary', 'digital', 'photographic', 'video',
  'biological', 'trace', 'testimonial', 'other',
];

const DEFAULT_SECURITY: SecurityConfig = {
  min_password_length: '8',
  require_uppercase: '1',
  require_numbers: '1',
  require_special_chars: '0',
  max_login_attempts: '5',
  lockout_duration_minutes: '15',
  max_active_sessions: '3',
  password_expiry_days: '0',
};

const DEFAULT_BRANDING: BrandingConfig = {
  report_header_text: 'RMPG SECURITY SERVICES',
  report_subheader_text: 'PRIVATE SECURITY',
  primary_color: '#dc2626',
  accent_color: '#d4a017',
  header_bg_color: '#1a1a2e',
};

const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  agency_name: 'RMPG Security',
  agency_ori: '',
  default_timezone: 'America/Denver',
  auto_archive_days: '90',
  session_timeout_minutes: '480',
  feature_bolos: '1',
  feature_warrants: '1',
  feature_fleet: '1',
  feature_evidence: '1',
  feature_patrol_checkpoints: '1',
};

const LS_ADMIN_SECTIONS = 'rmpg_admin_sections';

const UNIT_STATUSES: { value: UnitStatus; label: string }[] = [
  { value: 'off_duty', label: 'Off Duty' },
  { value: 'available', label: 'Available' },
  { value: 'busy', label: 'Busy' },
];

// ============================================================
// Props
// ============================================================

interface AdminSystemTabProps {
  users: (User & { last_login_display?: string })[];
  error: string | null;
  setError: (error: string | null) => void;
  LoadingSpinner: React.FC;
}

// ============================================================
// Static sidebar sections — defined outside the component so the
// array identity is stable across renders and never causes the
// content panel to remount (which would steal input focus).
// ============================================================
const SECTIONS: { id: SysSection; label: string; icon: React.ElementType }[] = [
  { id: 'settings', label: 'System Settings', icon: Settings },
  { id: 'branding', label: 'Branding & Reports', icon: FileText },
  { id: 'security', label: 'Security Policy', icon: Cog },
  { id: 'incident_types', label: 'Incident Types', icon: Siren },
  { id: 'dispositions', label: 'Dispositions', icon: CheckCircle },
  { id: 'priorities', label: 'Priority Levels', icon: AlertCircle },
  { id: 'call_sources', label: 'Call Sources', icon: Phone },
  { id: 'unit_types', label: 'Unit Types', icon: Car },
  { id: 'units', label: 'Dispatch Units', icon: Radio },
  { id: 'zones', label: 'Zones & Beats', icon: MapPin },
  { id: 'templates', label: 'Quick Templates', icon: FileText },
  { id: 'evidence_types', label: 'Evidence Types', icon: Hash },
  { id: 'criminal_codes', label: 'Criminal Codes', icon: Scale },
];

// ============================================================
// Component
// ============================================================

export default function AdminSystemTab({
  users,
  error,
  setError,
  LoadingSpinner,
}: AdminSystemTabProps) {
  // --- Config state ---
  const [incidentTypes, setIncidentTypes] = useState<ConfigItem[]>([]);
  const [dispositionCodes, setDispositionCodes] = useState<ConfigItem[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [newIncidentType, setNewIncidentType] = useState('');
  const [newDispCode, setNewDispCode] = useState('');
  const [newDispDesc, setNewDispDesc] = useState('');
  const [newDispColor, setNewDispColor] = useState('#3b82f6');

  // Active section (sidebar navigation instead of collapsible sections)
  const [activeSection, setActiveSectionState] = useState<SysSection>(() => {
    try {
      const saved = localStorage.getItem(LS_ADMIN_SECTIONS);
      if (saved) {
        // Migrate from old array format to single section
        const parsed = JSON.parse(saved);
        if (typeof parsed === 'string') return parsed as SysSection;
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0] as SysSection;
      }
    } catch { /* ignore */ }
    return 'settings';
  });
  const setActiveSection = useCallback((section: SysSection) => {
    setActiveSectionState(section);
    try { localStorage.setItem(LS_ADMIN_SECTIONS, JSON.stringify(section)); } catch { /* ignore */ }
  }, []);
  // Keep expandedSections API compatible for auto-search triggers
  const expandedSections = { has: (s: SysSection) => activeSection === s } as Set<SysSection>;

  // Priority configuration
  const [priorities, setPriorities] = useState<PriorityConfig[]>(DEFAULT_PRIORITIES);
  const [prioritiesDirty, setPrioritiesDirty] = useState(false);

  // Call Sources
  const [callSources, setCallSources] = useState<string[]>(DEFAULT_CALL_SOURCES);
  const [newCallSource, setNewCallSource] = useState('');
  const [callSourcesDirty, setCallSourcesDirty] = useState(false);

  // Unit Types
  const [unitTypes, setUnitTypes] = useState<UnitTypeConfig[]>(DEFAULT_UNIT_TYPES);
  const [newUnitType, setNewUnitType] = useState('');
  const [newUnitLabel, setNewUnitLabel] = useState('');
  const [newUnitColor, setNewUnitColor] = useState('#3b82f6');
  const [unitTypesDirty, setUnitTypesDirty] = useState(false);

  // Dispatch Units
  const [adminUnits, setAdminUnits] = useState<Unit[]>([]);
  const [loadingAdminUnits, setLoadingAdminUnits] = useState(false);
  const [newUnitCallSign, setNewUnitCallSign] = useState('');
  const [newUnitOfficerId, setNewUnitOfficerId] = useState('');
  const [newUnitStatusVal, setNewUnitStatusVal] = useState<string>('off_duty');
  const [editingAdminUnitId, setEditingAdminUnitId] = useState<string | null>(null);
  const [editUnitCallSign, setEditUnitCallSign] = useState('');
  const [editUnitOfficerId, setEditUnitOfficerId] = useState('');
  const [editUnitStatus, setEditUnitStatus] = useState<string>('off_duty');
  const [deletingUnitId, setDeletingUnitId] = useState<string | null>(null);
  const [unitDeleteLoading, setUnitDeleteLoading] = useState(false);
  const [unitSaving, setUnitSaving] = useState(false);

  // Zones & Beats
  const [zones, setZones] = useState<ZoneBeat[]>([]);
  const [newZoneCode, setNewZoneCode] = useState('');
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneDesc, setNewZoneDesc] = useState('');
  const [zonesDirty, setZonesDirty] = useState(false);

  // Call Templates
  const [callTemplates, setCallTemplates] = useState<CallTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateType, setNewTemplateType] = useState('alarm_response');
  const [newTemplatePriority, setNewTemplatePriority] = useState('P3');
  const [newTemplateDesc, setNewTemplateDesc] = useState('');

  // Evidence Types
  const [evidenceTypes, setEvidenceTypes] = useState<string[]>(DEFAULT_EVIDENCE_TYPES);
  const [newEvidenceType, setNewEvidenceType] = useState('');
  const [evidenceTypesDirty, setEvidenceTypesDirty] = useState(false);

  // Security Settings
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig>({ ...DEFAULT_SECURITY });
  const [securityDirty, setSecurityDirty] = useState(false);

  // Branding
  const [brandingConfig, setBrandingConfig] = useState<BrandingConfig>({ ...DEFAULT_BRANDING });
  const [brandingDirty, setBrandingDirty] = useState(false);

  // System Settings
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({ ...DEFAULT_SYSTEM_SETTINGS });
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Criminal Codes (Utah Statutes)
  const [statutes, setStatutes] = useState<any[]>([]);
  const [statuteSearch, setStatuteSearch] = useState('');
  const [statuteCategory, setStatuteCategory] = useState<'all' | 'criminal' | 'vehicle'>('all');
  const [loadingStatutes, setLoadingStatutes] = useState(false);
  const [statutePage, setStatutePage] = useState(1);
  const [statuteTotalPages, setStatuteTotalPages] = useState(1);
  const [statuteTotal, setStatuteTotal] = useState(0);

  // Editing inline state — Disposition Codes
  const [editingDispId, setEditingDispId] = useState<number | null>(null);
  const [editDispDesc, setEditDispDesc] = useState('');
  const [editDispColor, setEditDispColor] = useState('#3b82f6');

  // Editing inline state — Call Sources
  const [editingCallSourceIdx, setEditingCallSourceIdx] = useState<number | null>(null);
  const [editCallSourceVal, setEditCallSourceVal] = useState('');

  // Editing inline state — Unit Types
  const [editingUnitTypeKey, setEditingUnitTypeKey] = useState<string | null>(null);
  const [editUnitTypeLabel, setEditUnitTypeLabel] = useState('');
  const [editUnitTypeColor, setEditUnitTypeColor] = useState('#3b82f6');

  // Editing inline state — Zones & Beats
  const [editingZoneCode, setEditingZoneCode] = useState<string | null>(null);
  const [editZoneName, setEditZoneName] = useState('');
  const [editZoneDesc, setEditZoneDesc] = useState('');

  // Editing inline state — Call Templates
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [editTemplateName, setEditTemplateName] = useState('');
  const [editTemplateType, setEditTemplateType] = useState('');
  const [editTemplatePriority, setEditTemplatePriority] = useState('');
  const [editTemplateDesc, setEditTemplateDesc] = useState('');

  // Editing inline state — Evidence Types
  const [editingEvidenceIdx, setEditingEvidenceIdx] = useState<number | null>(null);
  const [editEvidenceVal, setEditEvidenceVal] = useState('');

  // Refs for latest state (prevents stale closures in debounced saves)
  const prioritiesRef = useRef(priorities);
  const callSourcesRef = useRef(callSources);
  const unitTypesRef = useRef(unitTypes);
  const zonesRef = useRef(zones);
  const evidenceTypesRef = useRef(evidenceTypes);
  const securityConfigRef = useRef(securityConfig);
  const brandingConfigRef = useRef(brandingConfig);
  const systemSettingsRef = useRef(systemSettings);

  useEffect(() => { prioritiesRef.current = priorities; }, [priorities]);
  useEffect(() => { callSourcesRef.current = callSources; }, [callSources]);
  useEffect(() => { unitTypesRef.current = unitTypes; }, [unitTypes]);
  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { evidenceTypesRef.current = evidenceTypes; }, [evidenceTypes]);
  useEffect(() => { securityConfigRef.current = securityConfig; }, [securityConfig]);
  useEffect(() => { brandingConfigRef.current = brandingConfig; }, [brandingConfig]);
  useEffect(() => { systemSettingsRef.current = systemSettings; }, [systemSettings]);

  // Navigation guard
  const hasUnsaved = prioritiesDirty || callSourcesDirty || unitTypesDirty || zonesDirty
    || evidenceTypesDirty || securityDirty || brandingDirty || settingsDirty;
  useUnsavedChanges(hasUnsaved);

  // Config ID cache for fast PUT saves
  const configIdCacheRef = useRef<Record<string, number>>({});

  // ============================================================
  // Fetch helpers
  // ============================================================

  const fetchConfig = useCallback(async () => {
    setLoadingConfig(true);
    setError(null);
    try {
      const grouped = await apiFetch<Record<string, ConfigItem[]>>('/admin/config');
      setIncidentTypes(grouped.incident_types || []);
      setDispositionCodes(grouped.dispositions || []);

      const loadJsonSection = <T,>(
        category: string,
        key: string,
        setter: (val: T) => void,
        defaults?: T,
      ) => {
        const items = grouped[category] || [];
        if (items.length > 0) {
          const item = items.find((i: ConfigItem) => i.config_key === key) || items[0];
          configIdCacheRef.current[`${category}:${key}`] = item.id;
          try {
            const parsed = JSON.parse(item.config_value) as T;
            setter(defaults ? { ...defaults, ...parsed } : parsed);
          } catch { /* use defaults */ }
        }
      };

      loadJsonSection<PriorityConfig[]>('priority_config', 'priority_levels', setPriorities);
      loadJsonSection<string[]>('call_sources', 'call_source_list', setCallSources);
      loadJsonSection<UnitTypeConfig[]>('unit_types', 'unit_type_list', setUnitTypes);
      loadJsonSection<ZoneBeat[]>('zones_beats', 'zone_beat_list', setZones);
      loadJsonSection<string[]>('evidence_types', 'evidence_type_list', setEvidenceTypes);
      loadJsonSection<SecurityConfig>('security_config', 'security_settings', setSecurityConfig, DEFAULT_SECURITY);
      loadJsonSection<BrandingConfig>('branding', 'branding_settings', setBrandingConfig, DEFAULT_BRANDING);

      const settingsItems = grouped.system_settings || [];
      if (settingsItems.length > 0) {
        const loaded = { ...DEFAULT_SYSTEM_SETTINGS };
        for (const item of settingsItems) {
          loaded[item.config_key] = item.config_value;
        }
        setSystemSettings(loaded);
      }

      setPrioritiesDirty(false);
      setCallSourcesDirty(false);
      setUnitTypesDirty(false);
      setZonesDirty(false);
      setEvidenceTypesDirty(false);
      setSecurityDirty(false);
      setBrandingDirty(false);
      setSettingsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  const fetchCallTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const templates = await apiFetch<CallTemplate[]>('/admin/call-templates');
      setCallTemplates(templates.filter((t) => t.is_active));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load call templates');
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const fetchAdminUnits = useCallback(async () => {
    setLoadingAdminUnits(true);
    try {
      const data = await apiFetch<any[]>('/dispatch/units');
      setAdminUnits((Array.isArray(data) ? data : []).map((u) => ({
        id: String(u.id),
        call_sign: u.call_sign || '',
        officer_id: u.officer_id ? String(u.officer_id) : '',
        officer_name: u.officer_name || '',
        status: u.status || 'off_duty',
        current_call_id: u.current_call_id ? String(u.current_call_id) : undefined,
        current_call_number: u.call_number || undefined,
        vehicle: u.vehicle_id || undefined,
        latitude: u.latitude,
        longitude: u.longitude,
        last_status_change: u.last_status_change || '',
        created_at: u.created_at || '',
        updated_at: u.updated_at || '',
      } as Unit)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load units');
    } finally {
      setLoadingAdminUnits(false);
    }
  }, []);

  const fetchStatutes = useCallback(async (search = '', category = 'all', pg = 1) => {
    setLoadingStatutes(true);
    try {
      const params = new URLSearchParams({ limit: '20', offset: String((pg - 1) * 20) });
      if (search) params.set('q', search);
      if (category !== 'all') params.set('category', category);
      const res = await apiFetch<{ data: any[]; pagination: { total: number; totalPages: number } }>(`/statutes?${params.toString()}`);
      setStatutes(res.data || []);
      setStatuteTotal(res.pagination?.total || 0);
      setStatuteTotalPages(res.pagination?.totalPages || 1);
    } catch { setStatutes([]); }
    finally { setLoadingStatutes(false); }
  }, []);

  // Load data on mount
  useEffect(() => {
    fetchConfig();
    fetchCallTemplates();
    fetchAdminUnits();
  }, [fetchConfig, fetchCallTemplates, fetchAdminUnits]);

  // Auto-search statutes when section is expanded
  useEffect(() => {
    if (expandedSections.has('criminal_codes')) {
      fetchStatutes(statuteSearch, statuteCategory, statutePage);
    }
  }, [expandedSections, statuteSearch, statuteCategory, statutePage, fetchStatutes]);

  // ============================================================
  // Save JSON config helper
  // ============================================================

  const saveJsonConfig = async (key: string, category: string, value: unknown) => {
    const jsonVal = JSON.stringify(value);
    try {
      const cachedId = configIdCacheRef.current[`${category}:${key}`];
      if (cachedId) {
        await apiFetch(`/admin/config/${cachedId}`, {
          method: 'PUT',
          body: JSON.stringify({ config_value: jsonVal }),
        });
        return;
      }

      const grouped = await apiFetch<Record<string, ConfigItem[]>>('/admin/config');
      const existing = (grouped[category] || []).find((i) => i.config_key === key);
      if (existing) {
        configIdCacheRef.current[`${category}:${key}`] = existing.id;
        await apiFetch(`/admin/config/${existing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ config_value: jsonVal }),
        });
      } else {
        const created = await apiFetch<ConfigItem>('/admin/config', {
          method: 'POST',
          body: JSON.stringify({ config_key: key, config_value: jsonVal, category }),
        });
        if (created?.id) configIdCacheRef.current[`${category}:${key}`] = created.id;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to save ${category}`);
      throw err; // Re-throw so callers know save failed (dirty flag stays true)
    }
  };

  // ============================================================
  // Config handlers
  // ============================================================

  const toggleSection = (section: SysSection) => {
    setActiveSection(section);
  };

  // Incident types
  const addIncidentType = async () => {
    const value = newIncidentType.trim().toLowerCase().replace(/\s+/g, '_');
    if (!value) return;
    try {
      await apiFetch('/admin/config', {
        method: 'POST',
        body: JSON.stringify({ config_key: 'incident_type', config_value: value, category: 'incident_types' }),
      });
      setNewIncidentType('');
      await fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add incident type');
    }
  };

  const removeConfigItem = async (id: number) => {
    try {
      await apiFetch(`/admin/config/${id}`, { method: 'DELETE' });
      await fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove config item');
    }
  };

  // Disposition codes
  const addDispositionCode = async () => {
    const code = newDispCode.trim().toUpperCase();
    const desc = newDispDesc.trim();
    if (!code || !desc) return;
    try {
      await apiFetch('/admin/config', {
        method: 'POST',
        body: JSON.stringify({
          config_key: 'disposition_code',
          config_value: JSON.stringify({ code, description: desc, color: newDispColor }),
          category: 'dispositions',
        }),
      });
      setNewDispCode('');
      setNewDispDesc('');
      setNewDispColor('#3b82f6');
      await fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add disposition code');
    }
  };

  const updateDispositionCode = async (id: number) => {
    try {
      const item = dispositionCodes.find((d) => d.id === id);
      if (!item) return;
      let parsed = { code: '', description: '', color: '#3b82f6' };
      try { parsed = JSON.parse(item.config_value); } catch { /* ignore */ }

      await apiFetch(`/admin/config/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          config_value: JSON.stringify({ code: parsed.code, description: editDispDesc, color: editDispColor }),
        }),
      });
      setEditingDispId(null);
      await fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update disposition');
    }
  };

  // Priority handlers
  const updatePriority = (index: number, field: keyof PriorityConfig, value: string) => {
    setPriorities((prev) => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
    setPrioritiesDirty(true);
  };

  const savePriorities = async () => {
    try {
      await saveJsonConfig('priority_levels', 'priority_config', prioritiesRef.current);
      setPrioritiesDirty(false);
    } catch { /* dirty flag stays true so user retries */ }
  };

  // Call Sources handlers
  const addCallSource = () => {
    const src = newCallSource.trim().toLowerCase().replace(/\s+/g, '_');
    if (!src || callSources.includes(src)) return;
    setCallSources((prev) => [...prev, src]);
    setNewCallSource('');
    setCallSourcesDirty(true);
  };

  const removeCallSource = (src: string) => {
    setCallSources((prev) => prev.filter((s) => s !== src));
    setCallSourcesDirty(true);
  };

  const moveCallSource = (index: number, dir: 'up' | 'down') => {
    setCallSources((prev) => {
      const arr = [...prev];
      const swap = dir === 'up' ? index - 1 : index + 1;
      if (swap < 0 || swap >= arr.length) return arr;
      [arr[index], arr[swap]] = [arr[swap], arr[index]];
      return arr;
    });
    setCallSourcesDirty(true);
  };

  const saveCallSources = async () => {
    try {
      await saveJsonConfig('call_source_list', 'call_sources', callSourcesRef.current);
      setCallSourcesDirty(false);
    } catch { /* dirty flag stays true so user retries */ }
  };

  const startEditCallSource = (index: number) => {
    setEditingCallSourceIdx(index);
    setEditCallSourceVal(callSources[index]);
  };

  const saveEditCallSource = () => {
    if (editingCallSourceIdx === null) return;
    const val = editCallSourceVal.trim().toLowerCase().replace(/\s+/g, '_');
    if (!val) return;
    setCallSources((prev) => prev.map((s, i) => i === editingCallSourceIdx ? val : s));
    setEditingCallSourceIdx(null);
    setEditCallSourceVal('');
    setCallSourcesDirty(true);
  };

  const cancelEditCallSource = () => {
    setEditingCallSourceIdx(null);
    setEditCallSourceVal('');
  };

  // Unit Types handlers
  const addUnitType = () => {
    const t = newUnitType.trim().toLowerCase().replace(/\s+/g, '_');
    const lbl = newUnitLabel.trim();
    if (!t || !lbl) return;
    if (unitTypes.some((u) => u.type === t)) return;
    setUnitTypes((prev) => [...prev, { type: t, label: lbl, color: newUnitColor }]);
    setNewUnitType('');
    setNewUnitLabel('');
    setNewUnitColor('#3b82f6');
    setUnitTypesDirty(true);
  };

  const removeUnitType = (type: string) => {
    setUnitTypes((prev) => prev.filter((u) => u.type !== type));
    setUnitTypesDirty(true);
  };

  const saveUnitTypes = async () => {
    try {
      await saveJsonConfig('unit_type_list', 'unit_types', unitTypesRef.current);
      setUnitTypesDirty(false);
    } catch { /* dirty flag stays true so user retries */ }
  };

  const startEditUnitType = (ut: UnitTypeConfig) => {
    setEditingUnitTypeKey(ut.type);
    setEditUnitTypeLabel(ut.label);
    setEditUnitTypeColor(ut.color);
  };

  const saveEditUnitType = () => {
    if (!editingUnitTypeKey) return;
    const lbl = editUnitTypeLabel.trim();
    if (!lbl) return;
    setUnitTypes((prev) => prev.map((u) => u.type === editingUnitTypeKey ? { ...u, label: lbl, color: editUnitTypeColor } : u));
    setEditingUnitTypeKey(null);
    setUnitTypesDirty(true);
  };

  const cancelEditUnitType = () => {
    setEditingUnitTypeKey(null);
  };

  // Zones handlers
  const addZone = () => {
    const code = newZoneCode.trim().toUpperCase();
    const name = newZoneName.trim();
    if (!code || !name) return;
    if (zones.some((z) => z.code === code)) return;
    setZones((prev) => [...prev, { code, name, description: newZoneDesc.trim() }]);
    setNewZoneCode('');
    setNewZoneName('');
    setNewZoneDesc('');
    setZonesDirty(true);
  };

  const removeZone = (code: string) => {
    setZones((prev) => prev.filter((z) => z.code !== code));
    setZonesDirty(true);
  };

  const saveZones = async () => {
    try {
      await saveJsonConfig('zone_beat_list', 'zones_beats', zonesRef.current);
      setZonesDirty(false);
    } catch { /* dirty flag stays true so user retries */ }
  };

  const startEditZone = (z: ZoneBeat) => {
    setEditingZoneCode(z.code);
    setEditZoneName(z.name);
    setEditZoneDesc(z.description);
  };

  const saveEditZone = () => {
    if (!editingZoneCode) return;
    const name = editZoneName.trim();
    if (!name) return;
    setZones((prev) => prev.map((z) => z.code === editingZoneCode ? { ...z, name, description: editZoneDesc.trim() } : z));
    setEditingZoneCode(null);
    setZonesDirty(true);
  };

  const cancelEditZone = () => {
    setEditingZoneCode(null);
  };

  // Evidence Types handlers
  const addEvidenceType = () => {
    const t = newEvidenceType.trim().toLowerCase().replace(/\s+/g, '_');
    if (!t || evidenceTypes.includes(t)) return;
    setEvidenceTypes((prev) => [...prev, t]);
    setNewEvidenceType('');
    setEvidenceTypesDirty(true);
  };

  const removeEvidenceType = (type: string) => {
    setEvidenceTypes((prev) => prev.filter((t) => t !== type));
    setEvidenceTypesDirty(true);
  };

  const saveEvidenceTypes = async () => {
    try {
      await saveJsonConfig('evidence_type_list', 'evidence_types', evidenceTypesRef.current);
      setEvidenceTypesDirty(false);
    } catch { /* dirty flag stays true so user retries */ }
  };

  const startEditEvidence = (index: number) => {
    setEditingEvidenceIdx(index);
    setEditEvidenceVal(evidenceTypes[index]);
  };

  const saveEditEvidence = () => {
    if (editingEvidenceIdx === null) return;
    const val = editEvidenceVal.trim().toLowerCase().replace(/\s+/g, '_');
    if (!val) return;
    setEvidenceTypes((prev) => prev.map((t, i) => i === editingEvidenceIdx ? val : t));
    setEditingEvidenceIdx(null);
    setEditEvidenceVal('');
    setEvidenceTypesDirty(true);
  };

  const cancelEditEvidence = () => {
    setEditingEvidenceIdx(null);
    setEditEvidenceVal('');
  };

  // Security config handlers
  const updateSecuritySetting = (key: keyof SecurityConfig, value: string) => {
    setSecurityConfig((prev) => ({ ...prev, [key]: value }));
    setSecurityDirty(true);
  };

  const toggleSecurityBool = (key: keyof SecurityConfig) => {
    setSecurityConfig((prev) => ({ ...prev, [key]: prev[key] === '1' ? '0' : '1' }));
    setSecurityDirty(true);
  };

  const saveSecurityConfig = async () => {
    try {
      await saveJsonConfig('security_settings', 'security_config', securityConfigRef.current);
      setSecurityDirty(false);
    } catch { /* dirty flag stays true so user retries */ }
  };

  // Branding handlers
  const updateBranding = (key: keyof BrandingConfig, value: string) => {
    setBrandingConfig((prev) => ({ ...prev, [key]: value }));
    setBrandingDirty(true);
  };

  const saveBrandingConfig = async () => {
    try {
      await saveJsonConfig('branding_settings', 'branding', brandingConfigRef.current);
      setBrandingDirty(false);
    } catch { /* dirty flag stays true so user retries */ }
  };

  // Call Template handlers
  const addCallTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) return;
    try {
      await apiFetch('/admin/call-templates', {
        method: 'POST',
        body: JSON.stringify({
          name,
          incident_type: newTemplateType,
          priority: newTemplatePriority,
          description_template: newTemplateDesc.trim() || null,
        }),
      });
      setNewTemplateName('');
      setNewTemplateType('alarm_response');
      setNewTemplatePriority('P3');
      setNewTemplateDesc('');
      await fetchCallTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add template');
    }
  };

  const removeCallTemplate = async (id: number) => {
    try {
      await apiFetch(`/admin/call-templates/${id}`, { method: 'DELETE' });
      await fetchCallTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove template');
    }
  };

  const startEditTemplate = (tpl: CallTemplate) => {
    setEditingTemplateId(tpl.id);
    setEditTemplateName(tpl.name);
    setEditTemplateType(tpl.incident_type);
    setEditTemplatePriority(tpl.priority);
    setEditTemplateDesc(tpl.description_template || '');
  };

  const saveEditTemplate = async () => {
    if (!editingTemplateId) return;
    try {
      await apiFetch(`/admin/call-templates/${editingTemplateId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editTemplateName.trim(),
          incident_type: editTemplateType,
          priority: editTemplatePriority,
          description_template: editTemplateDesc.trim() || null,
        }),
      });
      setEditingTemplateId(null);
      await fetchCallTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update template');
    }
  };

  const cancelEditTemplate = () => {
    setEditingTemplateId(null);
  };

  // System Settings handlers
  const updateSetting = (key: string, value: string) => {
    setSystemSettings((prev) => ({ ...prev, [key]: value }));
    setSettingsDirty(true);
  };

  const toggleFeature = (key: string) => {
    setSystemSettings((prev) => ({ ...prev, [key]: prev[key] === '1' ? '0' : '1' }));
    setSettingsDirty(true);
  };

  const saveSystemSettings = async () => {
    setSavingSettings(true);
    try {
      await apiFetch('/admin/system-settings', {
        method: 'PUT',
        body: JSON.stringify(systemSettingsRef.current),
      });
      setSettingsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // Dispatch Unit CRUD handlers
  const activeOfficers = users.filter((u) => u.is_active && !u.termination_date);

  const handleCreateUnit = async () => {
    const cs = newUnitCallSign.trim();
    if (!cs) return;
    setUnitSaving(true);
    try {
      await apiFetch('/dispatch/units', {
        method: 'POST',
        body: JSON.stringify({
          call_sign: cs,
          officer_id: newUnitOfficerId || null,
          status: newUnitStatusVal || 'off_duty',
        }),
      });
      setNewUnitCallSign('');
      setNewUnitOfficerId('');
      setNewUnitStatusVal('off_duty');
      await fetchAdminUnits();
    } catch (err: any) {
      setError(err?.message || 'Failed to create unit');
    } finally {
      setUnitSaving(false);
    }
  };

  const startEditUnit = (unit: Unit) => {
    setEditingAdminUnitId(unit.id);
    setEditUnitCallSign(unit.call_sign);
    setEditUnitOfficerId(unit.officer_id || '');
    setEditUnitStatus(unit.status);
  };

  const cancelEditUnit = () => {
    setEditingAdminUnitId(null);
    setEditUnitCallSign('');
    setEditUnitOfficerId('');
    setEditUnitStatus('off_duty');
  };

  const handleUpdateUnit = async () => {
    if (!editingAdminUnitId) return;
    const cs = editUnitCallSign.trim();
    if (!cs) return;
    setUnitSaving(true);
    try {
      await apiFetch(`/dispatch/units/${editingAdminUnitId}`, {
        method: 'PUT',
        body: JSON.stringify({
          call_sign: cs,
          officer_id: editUnitOfficerId || null,
          status: editUnitStatus,
        }),
      });
      cancelEditUnit();
      await fetchAdminUnits();
    } catch (err: any) {
      setError(err?.message || 'Failed to update unit');
    } finally {
      setUnitSaving(false);
    }
  };

  const handleDeleteUnit = async () => {
    if (!deletingUnitId) return;
    setUnitDeleteLoading(true);
    try {
      await apiFetch(`/dispatch/units/${deletingUnitId}`, { method: 'DELETE' });
      setDeletingUnitId(null);
      await fetchAdminUnits();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete unit');
      setDeletingUnitId(null);
    } finally {
      setUnitDeleteLoading(false);
    }
  };

  // ============================================================
  // Auto-save with debounce
  // ============================================================

  const autoSaveTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dirtyRef = useRef({
    priorities: false,
    callSources: false,
    unitTypes: false,
    zones: false,
    evidenceTypes: false,
    security: false,
    branding: false,
    systemSettings: false,
  });
  useEffect(() => { dirtyRef.current.priorities = prioritiesDirty; }, [prioritiesDirty]);
  useEffect(() => { dirtyRef.current.callSources = callSourcesDirty; }, [callSourcesDirty]);
  useEffect(() => { dirtyRef.current.unitTypes = unitTypesDirty; }, [unitTypesDirty]);
  useEffect(() => { dirtyRef.current.zones = zonesDirty; }, [zonesDirty]);
  useEffect(() => { dirtyRef.current.evidenceTypes = evidenceTypesDirty; }, [evidenceTypesDirty]);
  useEffect(() => { dirtyRef.current.security = securityDirty; }, [securityDirty]);
  useEffect(() => { dirtyRef.current.branding = brandingDirty; }, [brandingDirty]);
  useEffect(() => { dirtyRef.current.systemSettings = settingsDirty; }, [settingsDirty]);

  const scheduleAutoSave = useCallback((key: string, saveFn: () => Promise<void>) => {
    if (autoSaveTimerRef.current[key]) {
      clearTimeout(autoSaveTimerRef.current[key]);
    }
    autoSaveTimerRef.current[key] = setTimeout(() => {
      saveFn();
      delete autoSaveTimerRef.current[key];
    }, 1500);
  }, []);

  const flushPendingSaves = useCallback(() => {
    Object.values(autoSaveTimerRef.current).forEach(clearTimeout);
    autoSaveTimerRef.current = {};
    const d = dirtyRef.current;
    if (d.priorities) { savePriorities(); }
    if (d.callSources) { saveCallSources(); }
    if (d.unitTypes) { saveUnitTypes(); }
    if (d.zones) { saveZones(); }
    if (d.evidenceTypes) { saveEvidenceTypes(); }
    if (d.security) { saveSecurityConfig(); }
    if (d.branding) { saveBrandingConfig(); }
    if (d.systemSettings) { saveSystemSettings(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flushWithBeacon = useCallback(() => {
    Object.values(autoSaveTimerRef.current).forEach(clearTimeout);
    autoSaveTimerRef.current = {};

    const d = dirtyRef.current;
    const token = localStorage.getItem('rmpg_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const sendKeepalive = (url: string, method: string, body: unknown) => {
      try {
        fetch(`/api${url}`, {
          method,
          headers,
          body: JSON.stringify(body),
          keepalive: true,
        });
      } catch { /* best-effort */ }
    };

    const saveConfigBeacon = (key: string, category: string, value: unknown) => {
      const cachedId = configIdCacheRef.current[`${category}:${key}`];
      if (cachedId) {
        sendKeepalive(`/admin/config/${cachedId}`, 'PUT', { config_value: JSON.stringify(value) });
      } else {
        sendKeepalive('/admin/config', 'POST', {
          config_key: key,
          config_value: JSON.stringify(value),
          category,
        });
      }
    };

    if (d.priorities) saveConfigBeacon('priority_levels', 'priority_config', prioritiesRef.current);
    if (d.callSources) saveConfigBeacon('call_source_list', 'call_sources', callSourcesRef.current);
    if (d.unitTypes) saveConfigBeacon('unit_type_list', 'unit_types', unitTypesRef.current);
    if (d.zones) saveConfigBeacon('zone_beat_list', 'zones_beats', zonesRef.current);
    if (d.evidenceTypes) saveConfigBeacon('evidence_type_list', 'evidence_types', evidenceTypesRef.current);
    if (d.security) saveConfigBeacon('security_settings', 'security_config', securityConfigRef.current);
    if (d.branding) saveConfigBeacon('branding_settings', 'branding', brandingConfigRef.current);
    if (d.systemSettings) sendKeepalive('/admin/system-settings', 'PUT', systemSettingsRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush saves on component unmount
  useEffect(() => {
    return () => {
      Object.values(autoSaveTimerRef.current).forEach(clearTimeout);
      autoSaveTimerRef.current = {};
      flushWithBeacon();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush on window close / tab close
  useEffect(() => {
    const handleBeforeUnload = () => { flushWithBeacon(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') { flushPendingSaves(); }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save triggers
  useEffect(() => { if (prioritiesDirty) scheduleAutoSave('priorities', savePriorities); }, [prioritiesDirty, priorities]);
  useEffect(() => { if (callSourcesDirty) scheduleAutoSave('callSources', saveCallSources); }, [callSourcesDirty, callSources]);
  useEffect(() => { if (unitTypesDirty) scheduleAutoSave('unitTypes', saveUnitTypes); }, [unitTypesDirty, unitTypes]);
  useEffect(() => { if (zonesDirty) scheduleAutoSave('zones', saveZones); }, [zonesDirty, zones]);
  useEffect(() => { if (evidenceTypesDirty) scheduleAutoSave('evidenceTypes', saveEvidenceTypes); }, [evidenceTypesDirty, evidenceTypes]);
  useEffect(() => { if (securityDirty) scheduleAutoSave('security', saveSecurityConfig); }, [securityDirty, securityConfig]);
  useEffect(() => { if (brandingDirty) scheduleAutoSave('branding', saveBrandingConfig); }, [brandingDirty, brandingConfig]);
  useEffect(() => { if (settingsDirty) scheduleAutoSave('systemSettings', saveSystemSettings); }, [settingsDirty, systemSettings]);

  // ============================================================
  // Confirm dialog for unit delete (inline since ConfirmDialog is at parent)
  // ============================================================

  const renderUnitDeleteConfirm = () => {
    if (!deletingUnitId) return null;
    const unitName = adminUnits.find((u) => u.id === deletingUnitId)?.call_sign || '';
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-rmpg-800 border border-rmpg-600 p-6 max-w-md w-full mx-4">
          <h3 className="text-sm font-bold text-white mb-2">Delete Dispatch Unit</h3>
          <p className="text-xs text-rmpg-300 mb-4">
            Are you sure you want to permanently delete unit "{unitName}"? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeletingUnitId(null)} className="toolbar-btn">Cancel</button>
            <button
              onClick={handleDeleteUnit}
              disabled={unitDeleteLoading}
              className="toolbar-btn bg-red-900/50 text-red-400 hover:bg-red-900/70 border-red-700/50"
            >
              {unitDeleteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // Render
  // ============================================================

  // Badges computed separately so sidebar buttons use stable keys and don't
  // force the content panel to re-mount (which steals input focus).
  const sectionBadges: Partial<Record<SysSection, string | number>> = {
    incident_types: incidentTypes.length,
    units: adminUnits.length,
    criminal_codes: statuteTotal || undefined,
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ====== HORIZONTAL TAB STRIP ====== */}
      <div className="flex-shrink-0 border-b border-rmpg-700 bg-surface-sunken">
        <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto scrollbar-thin">
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            const badge = sectionBadges[sec.id];
            return (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium transition-all ${
                  isActive
                    ? 'bg-brand-900/40 text-white border border-brand-500/50'
                    : 'text-rmpg-400 hover:bg-rmpg-700/40 hover:text-rmpg-200 border border-transparent'
                }`}
              >
                <Icon className={`w-3 h-3 flex-shrink-0 ${isActive ? 'text-brand-400' : ''}`} />
                <span className="whitespace-nowrap">{sec.label}</span>
                {badge !== undefined && (
                  <span className={`text-[8px] font-mono px-1 py-px ${isActive ? 'bg-brand-900/50 text-brand-400' : 'bg-rmpg-700 text-rmpg-500'}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
          {hasUnsaved && (
            <span className="flex-shrink-0 flex items-center gap-1 ml-auto text-[9px] text-amber-400 px-2">
              <AlertCircle className="w-3 h-3" />
              Unsaved
            </span>
          )}
        </div>
      </div>

      {/* ====== CONTENT PANEL (full width) ====== */}
      <div className="flex-1 overflow-y-auto p-4">
      {loadingConfig ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* Section: Incident Type Codes */}
          {activeSection === 'incident_types' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <Siren className="w-4 h-4 text-brand-400" />
                Incident Type Codes
                <span className="text-[10px] text-rmpg-400 font-normal">({incidentTypes.length} active)</span>
              </h3>
            </div>
              <div className="px-4 pb-4">
                {(Object.entries(INCIDENT_TYPE_CATEGORIES) as [IncidentCategory, { value: string; label: string }[]][]).map(([category, types]) => {
                  const activeInCategory = types.filter((t) =>
                    incidentTypes.some((it) => it.config_value === t.value)
                  );
                  const inactiveInCategory = types.filter((t) =>
                    !incidentTypes.some((it) => it.config_value === t.value)
                  );
                  return (
                    <div key={category} className="mb-3">
                      <div className="text-[10px] font-bold text-rmpg-400 uppercase mb-1.5 border-b border-rmpg-700 pb-1">
                        {category} ({activeInCategory.length}/{types.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {activeInCategory.map((t) => {
                          const code = INCIDENT_TYPE_CODES[t.value] || '---';
                          const cfgItem = incidentTypes.find((it) => it.config_value === t.value);
                          return (
                            <span
                              key={t.value}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-rmpg-900 border border-rmpg-600 text-xs text-rmpg-200 hover:border-brand-500/50 transition-colors"
                            >
                              <span className="font-mono text-brand-400 text-[10px]">{code}</span>
                              <span className="text-rmpg-300">-</span>
                              {t.label}
                              {cfgItem && (
                                <button
                                  onClick={() => removeConfigItem(cfgItem.id)}
                                  className="text-rmpg-500 hover:text-red-400 transition-colors ml-1"
                                  title="Remove"
                                >
                                  <XCircle className="w-3 h-3" />
                                </button>
                              )}
                            </span>
                          );
                        })}
                        {inactiveInCategory.map((t) => {
                          const code = INCIDENT_TYPE_CODES[t.value] || '---';
                          return (
                            <button
                              key={t.value}
                              onClick={async () => {
                                try {
                                  await apiFetch('/admin/config', {
                                    method: 'POST',
                                    body: JSON.stringify({ config_key: 'incident_type', config_value: t.value, category: 'incident_types' }),
                                  });
                                  await fetchConfig();
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : 'Failed to add type');
                                }
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-dashed border-rmpg-700 text-xs text-rmpg-500 hover:border-brand-500/50 hover:text-rmpg-300 transition-colors"
                              title={`Add ${t.label}`}
                            >
                              <span className="font-mono text-[10px]">{code}</span>
                              <span className="text-rmpg-600">-</span>
                              {t.label}
                              <Plus className="w-3 h-3" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-rmpg-700">
                  <input
                    type="text"
                    className="input-dark text-xs w-64"
                    placeholder="Custom type key (e.g. noise_complaint)"
                    value={newIncidentType}
                    onChange={(e) => setNewIncidentType(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addIncidentType()}
                  />
                  <button className="toolbar-btn toolbar-btn-primary" onClick={addIncidentType}>
                    <Plus className="w-3 h-3" /> Add Custom
                  </button>
                </div>
              </div>
          </div>
          )}

          {/* Section 2: Disposition Codes */}
          {activeSection === 'dispositions' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <Hash className="w-4 h-4 text-brand-400" />
                Disposition Codes ({dispositionCodes.length})
              </h3>
            </div>
                <table className="table-dark">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>Color</th>
                      <th style={{ width: 80 }}>Code</th>
                      <th>Description</th>
                      <th style={{ width: 100 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispositionCodes.map((item) => {
                      let parsed = { code: '', description: '', color: '#3b82f6' };
                      try { parsed = JSON.parse(item.config_value); } catch { /* ignore */ }
                      const isEditing = editingDispId === item.id;
                      return (
                        <tr key={item.id}>
                          <td>
                            {isEditing ? (
                              <input type="color" value={editDispColor} onChange={(e) => setEditDispColor(e.target.value)} className="w-6 h-6 cursor-pointer border-0 p-0 bg-transparent" />
                            ) : (
                              <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: parsed.color || '#3b82f6' }} />
                            )}
                          </td>
                          <td className="font-bold text-white font-mono">{parsed.code}</td>
                          <td>
                            {isEditing ? (
                              <input
                                type="text"
                                className="input-dark text-xs w-full"
                                value={editDispDesc}
                                onChange={(e) => setEditDispDesc(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && updateDispositionCode(item.id)}
                              />
                            ) : (
                              <span className="text-rmpg-200">{parsed.description}</span>
                            )}
                          </td>
                          <td>
                            <div className="flex items-center gap-1">
                              {isEditing ? (
                                <>
                                  <button onClick={() => updateDispositionCode(item.id)} className="p-1 hover:bg-rmpg-700 text-green-400 hover:text-green-300" title="Save">
                                    <Save className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => setEditingDispId(null)} className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-rmpg-200" title="Cancel">
                                    <XCircle className="w-3 h-3" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => { setEditingDispId(item.id); setEditDispDesc(parsed.description); setEditDispColor(parsed.color || '#3b82f6'); }}
                                    className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-brand-400"
                                    title="Edit"
                                  >
                                    <Edit className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => removeConfigItem(item.id)} className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-red-400" title="Remove">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td>
                        <input type="color" value={newDispColor} onChange={(e) => setNewDispColor(e.target.value)} className="w-6 h-6 cursor-pointer border-0 p-0 bg-transparent" />
                      </td>
                      <td>
                        <input type="text" className="input-dark text-xs w-20" placeholder="Code" value={newDispCode} onChange={(e) => setNewDispCode(e.target.value)} />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="input-dark text-xs w-full"
                          placeholder="Description"
                          value={newDispDesc}
                          onChange={(e) => setNewDispDesc(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addDispositionCode()}
                        />
                      </td>
                      <td>
                        <button className="toolbar-btn toolbar-btn-primary" onClick={addDispositionCode}>
                          <Plus className="w-3 h-3" /> Add
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
          </div>
          )}

          {/* Section 3: Priority Configuration */}
          {activeSection === 'priorities' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-brand-400" />
                Priority Configuration
                {prioritiesDirty && <span className="text-amber-400 text-[9px] ml-2">(unsaved)</span>}
              </h3>
            </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {priorities.map((p, i) => (
                    <div key={p.level} className="p-3 bg-rmpg-900 border border-rmpg-600 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={p.color}
                          onChange={(e) => updatePriority(i, 'color', e.target.value)}
                          className="w-6 h-6 cursor-pointer border-0 p-0 bg-transparent"
                        />
                        <span className="text-sm font-bold text-white font-mono">{p.level}</span>
                      </div>
                      <div>
                        <label className="text-[9px] text-rmpg-400 uppercase">Label</label>
                        <input
                          type="text"
                          className="input-dark text-xs w-full"
                          value={p.label}
                          onChange={(e) => updatePriority(i, 'label', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-rmpg-400 uppercase">Response Target</label>
                        <input
                          type="text"
                          className="input-dark text-xs w-full"
                          value={p.target}
                          onChange={(e) => updatePriority(i, 'target', e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {prioritiesDirty && (
                  <div className="mt-3 flex justify-end">
                    <button className="toolbar-btn toolbar-btn-primary" onClick={savePriorities}>
                      <Save className="w-3 h-3" /> Save Priority Config
                    </button>
                  </div>
                )}
          </div>
          )}

          {/* Section 4: Call Sources */}
          {activeSection === 'call_sources' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <Phone className="w-4 h-4 text-brand-400" />
                Call Sources ({callSources.length})
                {callSourcesDirty && <span className="text-amber-400 text-[9px] ml-2">(unsaved)</span>}
              </h3>
            </div>
                <div className="space-y-1 mb-3">
                  {callSources.map((src, i) => (
                    <div key={src} className="flex items-center gap-2 p-2 bg-rmpg-900 border border-rmpg-600 hover:border-rmpg-500 transition-colors">
                      <span className="text-xs text-rmpg-400 font-mono w-6 text-center">{i + 1}</span>
                      {editingCallSourceIdx === i ? (
                        <>
                          <input
                            type="text"
                            className="input-dark text-xs flex-1"
                            value={editCallSourceVal}
                            onChange={(e) => setEditCallSourceVal(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEditCallSource(); if (e.key === 'Escape') cancelEditCallSource(); }}
                            autoFocus
                          />
                          <button onClick={saveEditCallSource} className="p-0.5 text-green-400 hover:text-green-300" title="Save">
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={cancelEditCallSource} className="p-0.5 text-rmpg-400 hover:text-rmpg-200" title="Cancel">
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-rmpg-200 flex-1">
                            {src.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                          </span>
                          <span className="text-[10px] text-rmpg-500 font-mono">{src}</span>
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => startEditCallSource(i)} className="p-0.5 text-rmpg-400 hover:text-brand-400" title="Edit">
                              <Edit className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => moveCallSource(i, 'up')}
                              disabled={i === 0}
                              className="p-0.5 text-rmpg-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
                              title="Move up"
                            >
                              <ChevronDown className="w-3 h-3 rotate-180" />
                            </button>
                            <button
                              onClick={() => moveCallSource(i, 'down')}
                              disabled={i === callSources.length - 1}
                              className="p-0.5 text-rmpg-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
                              title="Move down"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                            <button onClick={() => removeCallSource(src)} className="p-0.5 text-rmpg-400 hover:text-red-400" title="Remove">
                              <XCircle className="w-3 h-3" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className="input-dark text-xs w-48"
                    placeholder="New source (e.g. social_media)"
                    value={newCallSource}
                    onChange={(e) => setNewCallSource(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCallSource()}
                  />
                  <button className="toolbar-btn toolbar-btn-primary" onClick={addCallSource}>
                    <Plus className="w-3 h-3" /> Add Source
                  </button>
                  {callSourcesDirty && (
                    <button className="toolbar-btn toolbar-btn-primary ml-auto" onClick={saveCallSources}>
                      <Save className="w-3 h-3" /> Save Sources
                    </button>
                  )}
                </div>
          </div>
          )}

          {/* Section 5: Unit Types */}
          {activeSection === 'unit_types' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <Car className="w-4 h-4 text-brand-400" />
                Unit Types ({unitTypes.length})
                {unitTypesDirty && <span className="text-amber-400 text-[9px] ml-2">(unsaved)</span>}
              </h3>
            </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
                  {unitTypes.map((ut) => (
                    <div key={ut.type} className="flex items-center gap-2 p-2.5 bg-rmpg-900 border border-rmpg-600 hover:border-rmpg-500 transition-colors">
                      {editingUnitTypeKey === ut.type ? (
                        <>
                          <input type="color" value={editUnitTypeColor} onChange={(e) => setEditUnitTypeColor(e.target.value)} className="w-5 h-5 cursor-pointer border-0 p-0 bg-transparent flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <input
                              type="text"
                              className="input-dark text-xs w-full"
                              value={editUnitTypeLabel}
                              onChange={(e) => setEditUnitTypeLabel(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveEditUnitType(); if (e.key === 'Escape') cancelEditUnitType(); }}
                              autoFocus
                            />
                            <div className="text-[10px] text-rmpg-500 font-mono mt-0.5">{ut.type}</div>
                          </div>
                          <div className="flex flex-col gap-0.5 flex-shrink-0">
                            <button onClick={saveEditUnitType} className="p-0.5 text-green-400 hover:text-green-300" title="Save">
                              <CheckCircle className="w-3 h-3" />
                            </button>
                            <button onClick={cancelEditUnitType} className="p-0.5 text-rmpg-400 hover:text-rmpg-200" title="Cancel">
                              <XCircle className="w-3 h-3" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-4 h-4 rounded-sm flex-shrink-0" style={{ backgroundColor: ut.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white font-medium truncate">{ut.label}</div>
                            <div className="text-[10px] text-rmpg-500 font-mono">{ut.type}</div>
                          </div>
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <button onClick={() => startEditUnitType(ut)} className="text-rmpg-400 hover:text-brand-400" title="Edit">
                              <Edit className="w-3 h-3" />
                            </button>
                            <button onClick={() => removeUnitType(ut.type)} className="text-rmpg-400 hover:text-red-400" title="Remove">
                              <XCircle className="w-3 h-3" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="color" value={newUnitColor} onChange={(e) => setNewUnitColor(e.target.value)} className="w-6 h-6 cursor-pointer border-0 p-0 bg-transparent" />
                  <input
                    type="text"
                    className="input-dark text-xs w-32"
                    placeholder="Key (e.g. k9)"
                    value={newUnitType}
                    onChange={(e) => setNewUnitType(e.target.value)}
                  />
                  <input
                    type="text"
                    className="input-dark text-xs w-40"
                    placeholder="Label (e.g. K9 Unit)"
                    value={newUnitLabel}
                    onChange={(e) => setNewUnitLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addUnitType()}
                  />
                  <button className="toolbar-btn toolbar-btn-primary" onClick={addUnitType}>
                    <Plus className="w-3 h-3" /> Add Type
                  </button>
                  {unitTypesDirty && (
                    <button className="toolbar-btn toolbar-btn-primary ml-auto" onClick={saveUnitTypes}>
                      <Save className="w-3 h-3" /> Save Unit Types
                    </button>
                  )}
                </div>
          </div>
          )}

          {/* Section 5b: Dispatch Units */}
          {activeSection === 'units' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <Radio className="w-4 h-4 text-brand-400" />
                Dispatch Units ({adminUnits.length})
              </h3>
            </div>
                {loadingAdminUnits ? (
                  <div className="flex items-center justify-center py-6 text-rmpg-400">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading units...
                  </div>
                ) : (
                  <>
                    {adminUnits.length > 0 ? (
                      <table className="table-dark mb-3">
                        <thead>
                          <tr>
                            <th style={{ width: 140 }}>Call Sign</th>
                            <th style={{ width: 200 }}>Officer</th>
                            <th style={{ width: 120 }}>Status</th>
                            <th>Current Call</th>
                            <th style={{ width: 100 }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminUnits.map((unit) => (
                            <tr key={unit.id}>
                              {editingAdminUnitId === unit.id ? (
                                <>
                                  <td>
                                    <input type="text" className="input-dark text-xs w-full" value={editUnitCallSign} onChange={(e) => setEditUnitCallSign(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUpdateUnit()} />
                                  </td>
                                  <td>
                                    <select className="select-dark text-xs w-full" value={editUnitOfficerId} onChange={(e) => setEditUnitOfficerId(e.target.value)}>
                                      <option value="">-- None --</option>
                                      {activeOfficers.map((o) => (
                                        <option key={o.id} value={o.id}>{o.first_name} {o.last_name} {o.badge_number ? `(${o.badge_number})` : ''}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td>
                                    <select className="select-dark text-xs w-full" value={editUnitStatus} onChange={(e) => setEditUnitStatus(e.target.value)}>
                                      {UNIT_STATUSES.map((s) => (
                                        <option key={s.value} value={s.value}>{s.label}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="text-rmpg-500 text-xs">-</td>
                                  <td>
                                    <div className="flex items-center gap-1">
                                      <button onClick={handleUpdateUnit} disabled={unitSaving} className="toolbar-btn toolbar-btn-primary text-[10px]" title="Save">
                                        {unitSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                      </button>
                                      <button onClick={cancelEditUnit} className="toolbar-btn text-[10px]" title="Cancel">
                                        <XCircle className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td><span className="font-bold text-white font-mono text-xs">{unit.call_sign}</span></td>
                                  <td className="text-rmpg-200 text-xs">{unit.officer_name || <span className="text-rmpg-500">Unassigned</span>}</td>
                                  <td>
                                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded-sm border ${
                                      unit.status === 'available' ? 'bg-green-900/40 text-green-400 border-green-700/50' :
                                      unit.status === 'dispatched' ? 'bg-amber-900/40 text-amber-400 border-amber-700/50' :
                                      unit.status === 'enroute' ? 'bg-blue-900/40 text-blue-400 border-blue-700/50' :
                                      unit.status === 'onscene' ? 'bg-purple-900/40 text-purple-400 border-purple-700/50' :
                                      unit.status === 'busy' ? 'bg-red-900/40 text-red-400 border-red-700/50' :
                                      'bg-rmpg-700/40 text-rmpg-400 border-rmpg-600/50'
                                    }`}>
                                      {unit.status.replace(/_/g, ' ').toUpperCase()}
                                    </span>
                                  </td>
                                  <td className="text-xs font-mono text-rmpg-300">{unit.current_call_number || <span className="text-rmpg-500">-</span>}</td>
                                  <td>
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => startEditUnit(unit)} className="text-rmpg-400 hover:text-blue-400" title="Edit unit">
                                        <Edit className="w-3.5 h-3.5" />
                                      </button>
                                      {!unit.current_call_id && (
                                        <button onClick={() => setDeletingUnitId(unit.id)} className="text-rmpg-400 hover:text-red-400" title="Delete unit">
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-xs text-rmpg-400 mb-3">No dispatch units configured. Create units below to assign officers and dispatch them to calls.</p>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <input type="text" className="input-dark text-xs w-28" placeholder="Call Sign *" value={newUnitCallSign} onChange={(e) => setNewUnitCallSign(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateUnit()} />
                      <select className="select-dark text-xs w-44" value={newUnitOfficerId} onChange={(e) => setNewUnitOfficerId(e.target.value)}>
                        <option value="">-- Assign Officer --</option>
                        {activeOfficers.map((o) => (
                          <option key={o.id} value={o.id}>{o.first_name} {o.last_name} {o.badge_number ? `(${o.badge_number})` : ''}</option>
                        ))}
                      </select>
                      <select className="select-dark text-xs w-28" value={newUnitStatusVal} onChange={(e) => setNewUnitStatusVal(e.target.value)}>
                        {UNIT_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                      <button className="toolbar-btn toolbar-btn-primary" onClick={handleCreateUnit} disabled={!newUnitCallSign.trim() || unitSaving}>
                        {unitSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add Unit
                      </button>
                    </div>
                  </>
                )}
              </div>
          )}

          {/* Section 6: Zones & Beats */}
          {activeSection === 'zones' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <MapPin className="w-4 h-4 text-brand-400" />
                Sections, Zones & Beats ({zones.length})
                {zonesDirty && <span className="text-amber-400 text-[9px] ml-2">(unsaved)</span>}
              </h3>
            </div>
                {zones.length > 0 ? (
                  <table className="table-dark mb-3">
                    <thead>
                      <tr>
                        <th style={{ width: 80 }}>Code</th>
                        <th style={{ width: 200 }}>Name</th>
                        <th>Description</th>
                        <th style={{ width: 60 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zones.map((z) => (
                        <tr key={z.code}>
                          {editingZoneCode === z.code ? (
                            <>
                              <td className="font-bold text-white font-mono">{z.code}</td>
                              <td>
                                <input type="text" className="input-dark text-xs w-full" value={editZoneName} onChange={(e) => setEditZoneName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEditZone(); if (e.key === 'Escape') cancelEditZone(); }} autoFocus />
                              </td>
                              <td>
                                <input type="text" className="input-dark text-xs w-full" value={editZoneDesc} onChange={(e) => setEditZoneDesc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEditZone(); if (e.key === 'Escape') cancelEditZone(); }} />
                              </td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <button onClick={saveEditZone} className="p-1 text-green-400 hover:text-green-300" title="Save"><CheckCircle className="w-3 h-3" /></button>
                                  <button onClick={cancelEditZone} className="p-1 text-rmpg-400 hover:text-rmpg-200" title="Cancel"><XCircle className="w-3 h-3" /></button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="font-bold text-white font-mono">{z.code}</td>
                              <td className="text-rmpg-200">{z.name}</td>
                              <td className="text-rmpg-300 text-xs">{z.description || '--'}</td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => startEditZone(z)} className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-brand-400" title="Edit"><Edit className="w-3 h-3" /></button>
                                  <button onClick={() => removeZone(z.code)} className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-red-400" title="Remove"><Trash2 className="w-3 h-3" /></button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-xs text-rmpg-500 mb-3 py-4 text-center border border-dashed border-rmpg-700">No sections/zones/beats configured. Add your first entry below.</div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="text" className="input-dark text-xs w-20" placeholder="Code" value={newZoneCode} onChange={(e) => setNewZoneCode(e.target.value)} />
                  <input type="text" className="input-dark text-xs w-40" placeholder="Name" value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} />
                  <input type="text" className="input-dark text-xs flex-1 min-w-[160px]" placeholder="Description (optional)" value={newZoneDesc} onChange={(e) => setNewZoneDesc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addZone()} />
                  <button className="toolbar-btn toolbar-btn-primary" onClick={addZone}><Plus className="w-3 h-3" /> Add Entry</button>
                  {zonesDirty && (
                    <button className="toolbar-btn toolbar-btn-primary ml-auto" onClick={saveZones}><Save className="w-3 h-3" /> Save</button>
                  )}
                </div>
              </div>
          )}

          {/* Section 7: Evidence Types */}
          {activeSection === 'evidence_types' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <Hash className="w-4 h-4 text-brand-400" />
                Evidence Types ({evidenceTypes.length})
                {evidenceTypesDirty && <span className="text-amber-400 text-[9px] ml-2">(unsaved)</span>}
              </h3>
            </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {evidenceTypes.map((et, i) => (
                    <div key={et} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-rmpg-900 border border-rmpg-600 hover:border-rmpg-500 transition-colors">
                      {editingEvidenceIdx === i ? (
                        <>
                          <input type="text" className="input-dark text-xs w-36" value={editEvidenceVal} onChange={(e) => setEditEvidenceVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEditEvidence(); if (e.key === 'Escape') cancelEditEvidence(); }} autoFocus />
                          <button onClick={saveEditEvidence} className="p-0.5 text-green-400 hover:text-green-300" title="Save"><CheckCircle className="w-3 h-3" /></button>
                          <button onClick={cancelEditEvidence} className="p-0.5 text-rmpg-400 hover:text-rmpg-200" title="Cancel"><XCircle className="w-3 h-3" /></button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-rmpg-200">{et.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</span>
                          <span className="text-[10px] text-rmpg-500 font-mono">({et})</span>
                          <button onClick={() => startEditEvidence(i)} className="p-0.5 text-rmpg-400 hover:text-brand-400" title="Edit"><Edit className="w-3 h-3" /></button>
                          <button onClick={() => removeEvidenceType(et)} className="p-0.5 text-rmpg-400 hover:text-red-400" title="Remove"><XCircle className="w-3 h-3" /></button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input type="text" className="input-dark text-xs w-48" placeholder="New type (e.g. audio_recording)" value={newEvidenceType} onChange={(e) => setNewEvidenceType(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEvidenceType()} />
                  <button className="toolbar-btn toolbar-btn-primary" onClick={addEvidenceType}><Plus className="w-3 h-3" /> Add Type</button>
                  {evidenceTypesDirty && (
                    <button className="toolbar-btn toolbar-btn-primary ml-auto" onClick={saveEvidenceTypes}><Save className="w-3 h-3" /> Save Evidence Types</button>
                  )}
                </div>
              </div>
          )}

          {/* Section 8: Quick Dispatch Templates */}
          {activeSection === 'templates' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-400" />
                Quick Dispatch Templates ({callTemplates.length})
              </h3>
            </div>
                {loadingTemplates ? (
                  <div className="flex items-center gap-2 py-4 justify-center">
                    <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
                    <span className="text-xs text-rmpg-400">Loading templates...</span>
                  </div>
                ) : (
                  <>
                    {callTemplates.length > 0 ? (
                      <table className="table-dark mb-3">
                        <thead>
                          <tr>
                            <th>Template Name</th>
                            <th>Incident Type</th>
                            <th>Priority</th>
                            <th>Description</th>
                            <th style={{ width: 60 }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {callTemplates.map((tpl) => (
                            <tr key={tpl.id}>
                              {editingTemplateId === tpl.id ? (
                                <>
                                  <td>
                                    <input type="text" className="input-dark text-xs w-full" value={editTemplateName} onChange={(e) => setEditTemplateName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEditTemplate(); if (e.key === 'Escape') cancelEditTemplate(); }} autoFocus />
                                  </td>
                                  <td>
                                    <select className="select-dark text-xs w-full" value={editTemplateType} onChange={(e) => setEditTemplateType(e.target.value)}>
                                      {Object.entries(INCIDENT_TYPE_CODES).map(([key, code]) => (
                                        <option key={key} value={key}>{code} - {key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td>
                                    <select className="select-dark text-xs" value={editTemplatePriority} onChange={(e) => setEditTemplatePriority(e.target.value)}>
                                      {priorities.map((p) => (
                                        <option key={p.level} value={p.level}>{p.level}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td>
                                    <input type="text" className="input-dark text-xs w-full" value={editTemplateDesc} onChange={(e) => setEditTemplateDesc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEditTemplate(); if (e.key === 'Escape') cancelEditTemplate(); }} />
                                  </td>
                                  <td>
                                    <div className="flex items-center gap-1">
                                      <button onClick={saveEditTemplate} className="p-1 text-green-400 hover:text-green-300" title="Save"><CheckCircle className="w-3 h-3" /></button>
                                      <button onClick={cancelEditTemplate} className="p-1 text-rmpg-400 hover:text-rmpg-200" title="Cancel"><XCircle className="w-3 h-3" /></button>
                                    </div>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="font-semibold text-white">{tpl.name}</td>
                                  <td className="text-xs text-rmpg-200">
                                    <span className="font-mono text-brand-400 mr-1">{INCIDENT_TYPE_CODES[tpl.incident_type] || '---'}</span>
                                    {tpl.incident_type.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                  </td>
                                  <td>
                                    <span className={`font-mono font-bold text-xs ${
                                      tpl.priority === 'P1' ? 'text-red-400' :
                                      tpl.priority === 'P2' ? 'text-amber-400' :
                                      tpl.priority === 'P3' ? 'text-blue-400' :
                                      'text-rmpg-400'
                                    }`}>{tpl.priority}</span>
                                  </td>
                                  <td className="text-xs text-rmpg-300 max-w-xs truncate">{tpl.description_template || '--'}</td>
                                  <td>
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => startEditTemplate(tpl)} className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-brand-400" title="Edit"><Edit className="w-3 h-3" /></button>
                                      <button onClick={() => removeCallTemplate(tpl.id)} className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-red-400" title="Remove"><Trash2 className="w-3 h-3" /></button>
                                    </div>
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="text-xs text-rmpg-500 mb-3 py-4 text-center border border-dashed border-rmpg-700">No dispatch templates configured.</div>
                    )}
                    <div className="bg-rmpg-900 border border-rmpg-600 p-3 space-y-2">
                      <div className="text-[10px] text-rmpg-400 uppercase font-bold">Add Template</div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <input type="text" className="input-dark text-xs" placeholder="Template name" value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} />
                        <select className="select-dark text-xs" value={newTemplateType} onChange={(e) => setNewTemplateType(e.target.value)}>
                          {Object.entries(INCIDENT_TYPE_CODES).map(([key, code]) => (
                            <option key={key} value={key}>{code} - {key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</option>
                          ))}
                        </select>
                        <select className="select-dark text-xs" value={newTemplatePriority} onChange={(e) => setNewTemplatePriority(e.target.value)}>
                          {priorities.map((p) => (
                            <option key={p.level} value={p.level}>{p.level} - {p.label}</option>
                          ))}
                        </select>
                        <input type="text" className="input-dark text-xs" placeholder="Description template (optional)" value={newTemplateDesc} onChange={(e) => setNewTemplateDesc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCallTemplate()} />
                      </div>
                      <div className="flex justify-end">
                        <button className="toolbar-btn toolbar-btn-primary" onClick={addCallTemplate}><Plus className="w-3 h-3" /> Add Template</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
          )}

          {/* Section 9: Security Settings */}
          {activeSection === 'security' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <Settings className="w-4 h-4 text-red-400" />
                Security Settings
                {securityDirty && <span className="text-amber-400 text-[9px] ml-2">(unsaved)</span>}
              </h3>
            </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="text-[10px] text-rmpg-400 uppercase font-bold border-b border-rmpg-700 pb-1">Password Policy</div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Minimum Password Length</label>
                      <input type="number" className="input-dark text-xs w-full" value={securityConfig.min_password_length} onChange={(e) => updateSecuritySetting('min_password_length', e.target.value)} min="6" max="32" />
                    </div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Password Expiry (days, 0 = never)</label>
                      <input type="number" className="input-dark text-xs w-full" value={securityConfig.password_expiry_days} onChange={(e) => updateSecuritySetting('password_expiry_days', e.target.value)} min="0" max="365" />
                    </div>
                    <div className="space-y-2">
                      {[
                        { key: 'require_uppercase' as const, label: 'Require Uppercase Letters' },
                        { key: 'require_numbers' as const, label: 'Require Numbers' },
                        { key: 'require_special_chars' as const, label: 'Require Special Characters' },
                      ].map((opt) => (
                        <button
                          key={opt.key}
                          onClick={() => toggleSecurityBool(opt.key)}
                          className={`flex items-center gap-2 w-full p-2 border transition-colors text-left ${
                            securityConfig[opt.key] === '1'
                              ? 'bg-green-900/20 border-green-700/50'
                              : 'bg-rmpg-900 border-rmpg-600'
                          }`}
                        >
                          {securityConfig[opt.key] === '1' ? (
                            <ToggleRight className="w-4 h-4 text-green-400 flex-shrink-0" />
                          ) : (
                            <ToggleLeft className="w-4 h-4 text-rmpg-500 flex-shrink-0" />
                          )}
                          <span className={`text-xs ${securityConfig[opt.key] === '1' ? 'text-green-300' : 'text-rmpg-400'}`}>{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="text-[10px] text-rmpg-400 uppercase font-bold border-b border-rmpg-700 pb-1">Lockout & Sessions</div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Max Login Attempts</label>
                      <input type="number" className="input-dark text-xs w-full" value={securityConfig.max_login_attempts} onChange={(e) => updateSecuritySetting('max_login_attempts', e.target.value)} min="1" max="20" />
                      <p className="text-[9px] text-rmpg-500 mt-0.5">Account locks after this many failed attempts.</p>
                    </div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Lockout Duration (minutes)</label>
                      <input type="number" className="input-dark text-xs w-full" value={securityConfig.lockout_duration_minutes} onChange={(e) => updateSecuritySetting('lockout_duration_minutes', e.target.value)} min="1" max="1440" />
                    </div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Max Active Sessions</label>
                      <input type="number" className="input-dark text-xs w-full" value={securityConfig.max_active_sessions} onChange={(e) => updateSecuritySetting('max_active_sessions', e.target.value)} min="1" max="10" />
                      <p className="text-[9px] text-rmpg-500 mt-0.5">Maximum concurrent sessions per user.</p>
                    </div>
                  </div>
                </div>
                {securityDirty && (
                  <div className="mt-4 flex justify-end border-t border-rmpg-700 pt-3">
                    <button className="toolbar-btn toolbar-btn-primary" onClick={saveSecurityConfig}><Save className="w-3 h-3" /> Save Security Settings</button>
                  </div>
                )}
              </div>
          )}

          {/* Section 10: Branding */}
          {activeSection === 'branding' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <Cog className="w-4 h-4 text-brand-400" />
                Branding & Report Appearance
                {brandingDirty && <span className="text-amber-400 text-[9px] ml-2">(unsaved)</span>}
              </h3>
            </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="text-[10px] text-rmpg-400 uppercase font-bold border-b border-rmpg-700 pb-1">Brand Colors</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Primary</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={brandingConfig.primary_color} onChange={(e) => updateBranding('primary_color', e.target.value)} className="w-8 h-8 cursor-pointer border-0 p-0 bg-transparent" />
                          <span className="text-[10px] text-rmpg-500 font-mono">{brandingConfig.primary_color}</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Accent</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={brandingConfig.accent_color} onChange={(e) => updateBranding('accent_color', e.target.value)} className="w-8 h-8 cursor-pointer border-0 p-0 bg-transparent" />
                          <span className="text-[10px] text-rmpg-500 font-mono">{brandingConfig.accent_color}</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Header BG</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={brandingConfig.header_bg_color} onChange={(e) => updateBranding('header_bg_color', e.target.value)} className="w-8 h-8 cursor-pointer border-0 p-0 bg-transparent" />
                          <span className="text-[10px] text-rmpg-500 font-mono">{brandingConfig.header_bg_color}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-[10px] text-rmpg-400 uppercase font-bold border-b border-rmpg-700 pb-1 mb-3">Report Header Preview</div>
                  <div className="border border-rmpg-600 overflow-hidden" style={{ maxWidth: 500 }}>
                    <div className="px-4 py-3 text-center" style={{ backgroundColor: brandingConfig.header_bg_color }}>
                      <div className="font-bold tracking-wider" style={{ color: brandingConfig.primary_color, fontSize: 14 }}>
                        {brandingConfig.report_header_text || 'AGENCY NAME'}
                      </div>
                      <div className="text-[10px] tracking-widest mt-0.5" style={{ color: brandingConfig.accent_color }}>
                        {brandingConfig.report_subheader_text || 'SUBTITLE'}
                      </div>
                    </div>
                    <div className="h-[2px]" style={{ backgroundColor: brandingConfig.accent_color }} />
                    <div className="px-4 py-2 bg-rmpg-900">
                      <div className="flex justify-between text-[9px] text-rmpg-400">
                        <span>Report #: RKY26-00001-THF</span>
                        <span>Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>
                </div>
                {brandingDirty && (
                  <div className="mt-4 flex justify-end border-t border-rmpg-700 pt-3">
                    <button className="toolbar-btn toolbar-btn-primary" onClick={saveBrandingConfig}><Save className="w-3 h-3" /> Save Branding</button>
                  </div>
                )}
              </div>
          )}

          {/* Section 11: Criminal Codes (Utah Statutes) */}
          {activeSection === 'criminal_codes' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <Scale className="w-4 h-4 text-brand-400" />
                Criminal &amp; Vehicle Codes ({statuteTotal})
              </h3>
            </div>
                {/* Search + Filter bar */}
                <div className="flex gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" />
                    <input
                      type="text"
                      className="input-dark text-xs w-full pl-8"
                      placeholder="Search statutes (e.g. 76-5-102 or assault)..."
                      value={statuteSearch}
                      onChange={(e) => { setStatuteSearch(e.target.value); setStatutePage(1); }}
                    />
                  </div>
                  <select
                    className="select-dark text-xs"
                    value={statuteCategory}
                    onChange={(e) => { setStatuteCategory(e.target.value as any); setStatutePage(1); }}
                  >
                    <option value="all">All Categories</option>
                    <option value="criminal">Criminal (Title 76)</option>
                    <option value="vehicle">Vehicle (Title 41)</option>
                  </select>
                </div>

                {/* Statute Table */}
                {loadingStatutes ? (
                  <div className="text-center py-4"><Loader2 className="w-4 h-4 animate-spin inline-block text-rmpg-400" /></div>
                ) : statutes.length === 0 ? (
                  <p className="text-xs text-rmpg-400 py-4 text-center">No statutes found</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table-dark w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left px-2 py-1.5 text-[10px] text-rmpg-400 uppercase font-bold">Citation</th>
                          <th className="text-left px-2 py-1.5 text-[10px] text-rmpg-400 uppercase font-bold">Title</th>
                          <th className="text-left px-2 py-1.5 text-[10px] text-rmpg-400 uppercase font-bold">Category</th>
                          <th className="text-left px-2 py-1.5 text-[10px] text-rmpg-400 uppercase font-bold">Offense Level</th>
                          <th className="text-left px-2 py-1.5 text-[10px] text-rmpg-400 uppercase font-bold">Subcategory</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statutes.map((s: any) => (
                          <tr key={s.id} className="border-t border-rmpg-700/30 hover:bg-rmpg-700/20">
                            <td className="px-2 py-1.5 font-mono text-brand-400 font-bold whitespace-nowrap">{s.citation}</td>
                            <td className="px-2 py-1.5 text-rmpg-200 max-w-[250px] truncate">{s.short_title}</td>
                            <td className="px-2 py-1.5">
                              <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase border ${
                                s.category === 'criminal' ? 'bg-red-900/30 text-red-400 border-red-700/40' : 'bg-blue-900/30 text-blue-400 border-blue-700/40'
                              }`}>
                                {s.category === 'criminal' ? 'Criminal' : 'Vehicle'}
                              </span>
                            </td>
                            <td className="px-2 py-1.5"><OffenseLevelBadge level={s.offense_level} /></td>
                            <td className="px-2 py-1.5 text-rmpg-400 text-[10px] truncate max-w-[180px]">{s.subcategory}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination */}
                {statuteTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-rmpg-700">
                    <span className="text-[10px] text-rmpg-400">{statuteTotal} statutes total</span>
                    <div className="flex gap-1">
                      <button
                        className="toolbar-btn text-[10px] px-2 py-0.5"
                        disabled={statutePage <= 1}
                        onClick={() => setStatutePage((p) => Math.max(1, p - 1))}
                      >
                        Prev
                      </button>
                      <span className="text-[10px] text-rmpg-300 px-2 py-0.5">{statutePage} / {statuteTotalPages}</span>
                      <button
                        className="toolbar-btn text-[10px] px-2 py-0.5"
                        disabled={statutePage >= statuteTotalPages}
                        onClick={() => setStatutePage((p) => Math.min(statuteTotalPages, p + 1))}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
          )}

          {/* Section 12: System Settings */}
          {activeSection === 'settings' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider flex items-center gap-2">
                <Settings className="w-4 h-4 text-brand-400" />
                System Settings
                {settingsDirty && <span className="text-amber-400 text-[9px] ml-2">(unsaved)</span>}
              </h3>
            </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="text-[10px] text-rmpg-400 uppercase font-bold border-b border-rmpg-700 pb-1">Agency Information</div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Agency Name</label>
                      <input type="text" className="input-dark text-xs w-full" value={systemSettings.agency_name} onChange={(e) => updateSetting('agency_name', e.target.value)} placeholder="Used in PDF report headers" />
                    </div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Agency ORI Number</label>
                      <input type="text" className="input-dark text-xs w-full" value={systemSettings.agency_ori} onChange={(e) => updateSetting('agency_ori', e.target.value)} placeholder="e.g. UT0190000" />
                    </div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Default Timezone</label>
                      <select className="select-dark text-xs w-full" value={systemSettings.default_timezone} onChange={(e) => updateSetting('default_timezone', e.target.value)}>
                        <option value="America/New_York">Eastern (America/New_York)</option>
                        <option value="America/Chicago">Central (America/Chicago)</option>
                        <option value="America/Denver">Mountain (America/Denver)</option>
                        <option value="America/Phoenix">Arizona (America/Phoenix)</option>
                        <option value="America/Los_Angeles">Pacific (America/Los_Angeles)</option>
                        <option value="America/Anchorage">Alaska (America/Anchorage)</option>
                        <option value="Pacific/Honolulu">Hawaii (Pacific/Honolulu)</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="text-[10px] text-rmpg-400 uppercase font-bold border-b border-rmpg-700 pb-1">System Parameters</div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Auto-Archive After (days)</label>
                      <input type="number" className="input-dark text-xs w-full" value={systemSettings.auto_archive_days} onChange={(e) => updateSetting('auto_archive_days', e.target.value)} min="0" max="365" />
                      <p className="text-[9px] text-rmpg-500 mt-0.5">Closed calls are auto-archived after this many days. 0 = disabled.</p>
                    </div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Session Timeout (minutes)</label>
                      <input type="number" className="input-dark text-xs w-full" value={systemSettings.session_timeout_minutes} onChange={(e) => updateSetting('session_timeout_minutes', e.target.value)} min="5" max="1440" />
                      <p className="text-[9px] text-rmpg-500 mt-0.5">Inactive sessions are logged out after this duration.</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-[10px] text-rmpg-400 uppercase font-bold border-b border-rmpg-700 pb-1 mb-3">Feature Toggles</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                    {[
                      { key: 'feature_bolos', label: 'BOLOs', desc: 'Be On the Lookout alerts' },
                      { key: 'feature_warrants', label: 'Warrants', desc: 'Warrant tracking module' },
                      { key: 'feature_fleet', label: 'Fleet Mgmt', desc: 'Vehicle fleet management' },
                      { key: 'feature_evidence', label: 'Evidence', desc: 'Evidence tracking & chain of custody' },
                      { key: 'feature_patrol_checkpoints', label: 'Patrol QR', desc: 'QR checkpoint scanning' },
                    ].map((feat) => (
                      <button
                        key={feat.key}
                        onClick={() => toggleFeature(feat.key)}
                        className={`flex items-center gap-2 p-2.5 border transition-colors text-left ${
                          systemSettings[feat.key] === '1'
                            ? 'bg-green-900/20 border-green-700/50 hover:border-green-600'
                            : 'bg-rmpg-900 border-rmpg-600 hover:border-rmpg-500'
                        }`}
                      >
                        {systemSettings[feat.key] === '1' ? (
                          <ToggleRight className="w-5 h-5 text-green-400 flex-shrink-0" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-rmpg-500 flex-shrink-0" />
                        )}
                        <div>
                          <div className={`text-xs font-medium ${systemSettings[feat.key] === '1' ? 'text-green-300' : 'text-rmpg-400'}`}>{feat.label}</div>
                          <div className="text-[9px] text-rmpg-500">{feat.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                {settingsDirty && (
                  <div className="mt-4 flex justify-end border-t border-rmpg-700 pt-3">
                    <button className="toolbar-btn toolbar-btn-primary" onClick={saveSystemSettings} disabled={savingSettings}>
                      {savingSettings ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Save System Settings
                    </button>
                  </div>
                )}
          </div>
          )}
        </>
      )}
      </div>

      {/* Unit delete confirm dialog */}
      {renderUnitDeleteConfirm()}
    </div>
  );
}
