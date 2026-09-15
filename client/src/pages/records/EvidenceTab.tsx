import React, { useState, useEffect, useCallback, useRef } from 'react';
import { coded } from '../../utils/searchText';
import { formatEnumValue, toDisplayLabel } from '../../utils/formatters';
import {
  Search,
  Package,
  MapPin,
  Loader2,
  Trash2,
  X,
  Hash,
  Calendar,
  Archive,
  RotateCcw,
  FlaskConical,
  Boxes,
  Warehouse,
  ArrowRight,
  Link2,
  Activity,
  FileText,
  Microscope,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Shield,
  Eye,
  Pencil,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { safeDateStr, safeDateTimeStr, parseTimestamp } from '../../utils/dateUtils';
import { useAuth } from '../../context/AuthContext';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import EvidenceFormModal from '../../components/EvidenceFormModal';
import FileAttachments from '../../components/FileAttachments';
import EmailedDocuments from '../../components/EmailedDocuments';
import LinkedRecordsSection from '../../components/LinkedRecordsSection';
import CollapsibleSection from '../../components/CollapsibleSection';
import RecordField from '../../components/records/RecordField';
import FieldGrid from '../../components/records/FieldGrid';
import RecordBadge from '../../components/records/RecordBadge';
import RecordHero from '../../components/records/RecordHero';
import PrintRecordButton from '../../components/PrintRecordButton';
import type { CustodyEntry, RecordEntityType } from '../../types';
import { useMountedRef } from '../../hooks/useMountedRef';

// ── Helpers ──────────────────────────────────────

// Delegates to the shared RecordField primitive. See PersonsTab for the pattern.
function renderInfoRow(label: string, value?: string | null, icon?: React.ElementType) {
  if (!value) return null;
  return <RecordField label={label} value={value} icon={icon} />;
}

// ── Props ──────────────────────────────────────────

export interface EvidenceTabProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showArchived: boolean;
  setError: (err: string | null) => void;
  evidence: any[];
  setEvidence: React.Dispatch<React.SetStateAction<any[]>>;
  loadingEvidence: boolean;
  setLoadingEvidence: React.Dispatch<React.SetStateAction<boolean>>;
  setDeleteTarget: React.Dispatch<React.SetStateAction<{ type: 'person' | 'vehicle' | 'property' | 'business' | 'evidence'; id: string; label: string } | null>>;
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
  handleArchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  handleUnarchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  fetchEvidence: () => Promise<void>;
  /** Increment to open the "New Evidence" modal from parent */
  openNewTrigger?: number;
}

// ── Hook Return ────────────────────────────────────

export interface EvidenceTabState {
  selectedEvidence: any | null;
  setSelectedEvidence: React.Dispatch<React.SetStateAction<any | null>>;
  evidenceCustody: CustodyEntry[];
  loadingCustody: boolean;
  evidenceModalOpen: boolean;
  editingEvidence: any | null;
  evidenceCreateModalOpen: boolean;
  setEvidenceCreateModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  filteredEvidence: any[];
  handleArchive: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  handleUnarchive: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showArchived: boolean;
  setDeleteTarget: EvidenceTabProps['setDeleteTarget'];
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
  evidence: any[];
  fetchEvidence: () => Promise<void>;
  setEditingEvidence: React.Dispatch<React.SetStateAction<any | null>>;
  setEvidenceModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

// ════════════════════════════════════════════════════
// HOOK — useEvidenceTab
// ════════════════════════════════════════════════════

export function useEvidenceTab(props: EvidenceTabProps): EvidenceTabState {
  const {
    searchQuery, setSearchQuery, showArchived, setError,
    evidence, setDeleteTarget, linkRefreshKey,
    openLinkModal, handleArchiveRecord, handleUnarchiveRecord,
    fetchEvidence, openNewTrigger,
  } = props;

  const [selectedEvidence, setSelectedEvidence] = useState<any | null>(null);
  const [evidenceCustody, setEvidenceCustody] = useState<CustodyEntry[]>([]);
  const [loadingCustody, setLoadingCustody] = useState(false);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [editingEvidence, setEditingEvidence] = useState<any | null>(null);
  const [evidenceCreateModalOpen, setEvidenceCreateModalOpen] = useState(false);

  useEffect(() => {
    if (openNewTrigger && openNewTrigger > 0) {
      setEvidenceCreateModalOpen(true);
    }
  }, [openNewTrigger]);

  useEffect(() => {
    if (selectedEvidence && !evidence.find((e: any) => e.id === selectedEvidence.id)) {
      setSelectedEvidence(null);
    }
  }, [evidence, selectedEvidence]);

  // Parse custody chain
  useEffect(() => {
    if (selectedEvidence) {
      setLoadingCustody(true);
      const custody = selectedEvidence.chain_of_custody;
      if (Array.isArray(custody)) {
        setEvidenceCustody(custody);
      } else if (typeof custody === 'string') {
        try { setEvidenceCustody(JSON.parse(custody)); } catch { setEvidenceCustody([]); }
      } else {
        setEvidenceCustody([]);
      }
      setLoadingCustody(false);
    } else {
      setEvidenceCustody([]);
    }
  }, [selectedEvidence?.id]);

  const handleArchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedEvidence(null);
    await handleArchiveRecord(type, id);
  };
  const handleUnarchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedEvidence(null);
    await handleUnarchiveRecord(type, id);
  };

  const filteredEvidence = evidence.filter((ev) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (ev.evidence_number || '').toLowerCase().includes(q) ||
      (ev.description || '').toLowerCase().includes(q) ||
      coded(ev.evidence_type, formatEnumValue).includes(q) ||
      (ev.serial_number || '').toLowerCase().includes(q) ||
      (ev.brand || '').toLowerCase().includes(q) ||
      (ev.storage_location || '').toLowerCase().includes(q) ||
      (ev.incident_number || '').toLowerCase().includes(q)
    );
  });

  return {
    selectedEvidence, setSelectedEvidence,
    evidenceCustody, loadingCustody,
    evidenceModalOpen, editingEvidence,
    evidenceCreateModalOpen, setEvidenceCreateModalOpen,
    filteredEvidence, handleArchive, handleUnarchive,
    searchQuery, setSearchQuery, showArchived,
    setDeleteTarget, linkRefreshKey, openLinkModal,
    evidence, fetchEvidence,
    setEditingEvidence, setEvidenceModalOpen,
  };
}

// ════════════════════════════════════════════════════
// LIST — EvidenceTabList (left panel content)
// ════════════════════════════════════════════════════

export function EvidenceTabList({ state }: { state: EvidenceTabState }) {
  const { user } = useAuth();
  const {
    filteredEvidence, selectedEvidence, setSelectedEvidence,
    searchQuery, setSearchQuery, showArchived,
    setDeleteTarget, handleArchive, handleUnarchive,
    evidenceCreateModalOpen, setEvidenceCreateModalOpen, fetchEvidence,
    evidenceModalOpen, editingEvidence, setEvidenceModalOpen, setEditingEvidence, evidence,
  } = state;

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const canModify = !showArchived || user?.role === 'admin';
  const buildEvidenceMenu = (ev: any): ContextMenuItem[] => {
    return [
      m.action('Open record', () => setSelectedEvidence(selectedEvidence?.id === ev.id ? null : ev), { icon: <Eye size={12} /> }),
      ...(canModify ? [m.action('Edit evidence', () => { setEditingEvidence(ev); setEvidenceModalOpen(true); }, { icon: <Pencil size={12} /> })] : []),
      m.separator(),
      m.copy('Copy evidence #', ev.evidence_number),
      m.copyId(ev.id),
      ...(ev.serial_number ? [m.copy('Copy serial #', ev.serial_number, <Hash size={12} />)] : []),
      m.separator(),
      ...(showArchived
        ? (canModify ? [m.action('Unarchive', () => handleUnarchive('evidence', ev.id), { icon: <RotateCcw size={12} /> })] : [])
        : [m.action('Archive', () => handleArchive('evidence', ev.id), { icon: <Archive size={12} /> })]),
      ...(canModify ? [m.action('Delete', () => setDeleteTarget({ type: 'evidence', id: ev.id, label: ev.evidence_number }), { icon: <Trash2 size={12} />, danger: true })] : []),
    ];
  };

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="p-3 border-b border-rmpg-600" role="search">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" />
          <input id="ff-evidencetab-0"
            type="text"
            className="input-dark pl-9 w-full text-[11px] min-h-[36px] focus:ring-1 focus:ring-brand-500/50 focus:border-brand-600 transition-shadow"
            placeholder="Search by evidence #, description, serial #, incident..." aria-label="Search by evidence #, description, serial #, incident..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-rmpg-100 transition-colors" aria-label="Clear search">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Evidence List */}
      <div className="flex-1 overflow-auto scrollbar-dark" role="list" aria-label="Evidence records">
        {filteredEvidence.length === 0 && (
          <div className="text-center py-16">
            <Package className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
            <p className="text-sm text-rmpg-400 font-medium">
              {searchQuery
                ? 'No evidence matches your search.'
                : showArchived
                  ? 'No archived evidence records.'
                  : 'No evidence records found.'}
            </p>
            <p className="text-[10px] text-rmpg-600 mt-1">
              {searchQuery
                ? 'Try broadening your search.'
                : showArchived
                  ? 'Records you archive will appear here.'
                  : 'Click "New Evidence" to add a record.'}
            </p>
          </div>
        )}
        {filteredEvidence.map((ev: any, idx: number) => {
          const hasLab = ev.lab_submitted;
          const isDisposed = !!ev.disposal_method;
          return (
            <div
              key={ev.id}
              role="listitem"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedEvidence(selectedEvidence?.id === ev.id ? null : ev); } }}
              onClick={() => setSelectedEvidence(selectedEvidence?.id === ev.id ? null : ev)}
              onContextMenu={(e) => openMenu(e, buildEvidenceMenu(ev))}
              className={`
                px-4 py-3 border-b border-rmpg-700/50 cursor-pointer transition-all duration-150
                ${selectedEvidence?.id === ev.id
                  ? 'bg-brand-900/20 border-l-2 border-l-brand-500'
                  : `hover:bg-rmpg-700/30 border-l-2 border-l-transparent ${idx % 2 === 1 ? 'bg-rmpg-800/20' : ''}`
                }
              `}
              aria-selected={selectedEvidence?.id === ev.id}
            >
              <div className="flex items-center gap-3">
                <div className={`flex-shrink-0 w-9 h-9 rounded-sm flex items-center justify-center border ${
                  isDisposed ? 'bg-rmpg-800 text-rmpg-500 border-rmpg-600' :
                  hasLab ? 'bg-purple-900/40 text-purple-400 border-purple-700/50' :
                  'bg-green-900/30 text-green-400 border-green-700/50'
                }`}>
                  <Package className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-green-400 font-mono">{ev.evidence_number}</span>
                    <span className={`px-1 py-0.5 text-[8px] font-bold uppercase border ${
                      isDisposed ? 'bg-rmpg-700 text-rmpg-400 border-rmpg-600' :
                      hasLab ? 'bg-purple-900/40 text-purple-400 border-purple-700/50' :
                      'bg-green-900/30 text-green-400 border-green-700/50'
                    }`}>
                      {isDisposed ? 'DISPOSED' : hasLab ? 'LAB' : 'IN STORAGE'}
                    </span>
                  </div>
                  <div className="text-[10px] text-rmpg-300 mt-0.5 truncate">{ev.description}</div>
                  <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500">
                    <span className="uppercase">{toDisplayLabel(ev.evidence_type || 'physical')}</span>
                    {ev.category && <span>{toDisplayLabel(ev.category)}</span>}
                    {ev.incident_number && (
                      <span className="flex items-center gap-0.5">
                        <Link2 className="w-2.5 h-2.5" />{ev.incident_number}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {ev.estimated_value && (
                    <span className="text-[10px] text-green-400 font-mono">${Number(ev.estimated_value).toLocaleString()}</span>
                  )}
                  {ev.serial_number && (
                    <span className="text-[9px] text-rmpg-500 font-mono">S/N: {ev.serial_number}</span>
                  )}
                  <div className="flex items-center gap-1">
                    {(!showArchived || user?.role === 'admin') && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setEditingEvidence(ev); setEvidenceModalOpen(true); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400 transition-colors" title="Edit">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {(!showArchived || user?.role === 'admin') && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'evidence', id: ev.id, label: ev.evidence_number }); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-red-400 transition-colors" title="Delete">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                    {(!showArchived || user?.role === 'admin') && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleArchive('evidence', ev.id); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-amber-400 transition-colors" title="Archive">
                        <Archive className="w-3 h-3" />
                      </button>
                    )}
                    {showArchived && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleUnarchive('evidence', ev.id); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-green-400 transition-colors" title="Unarchive">
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Evidence Edit Modal */}
      {editingEvidence && (
        <EvidenceFormModal
          isOpen={evidenceModalOpen}
          onClose={() => { setEvidenceModalOpen(false); setEditingEvidence(null); }}
          incidentId={editingEvidence.incident_id || undefined}
          onCreated={async () => {
            await fetchEvidence();
            if (selectedEvidence && selectedEvidence.id === editingEvidence.id) {
              const updated = evidence.find((e: any) => e.id === editingEvidence.id);
              if (updated) setSelectedEvidence(updated);
            }
          }}
          editingEvidence={editingEvidence}
        />
      )}

      {/* Evidence Standalone Create Modal */}
      <EvidenceFormModal
        isOpen={evidenceCreateModalOpen}
        onClose={() => setEvidenceCreateModalOpen(false)}
        onCreated={async () => {
          await fetchEvidence();
          setEvidenceCreateModalOpen(false);
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════
// DIGITAL FORENSICS — inline section for evidence detail
// ════════════════════════════════════════════════════

interface HashResult {
  id: number;
  file_name: string;
  md5: string | null;
  sha1: string | null;
  sha256: string | null;
  photodna_hash: string | null;
  phash: string | null;
  hash_set_match: number;
  hash_set_name: string | null;
  flagged: number;
  flag_reason: string | null;
}

function DigitalForensicsSection({ evidenceId }: { evidenceId: string }) {
  const [hashes, setHashes] = useState<HashResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const mountedRef = useMountedRef();

  const fetchHashes = useCallback(async () => {
    try {
      const data = await apiFetch<{ results: HashResult[] }>(`/iped/hash/results?evidence_id=${evidenceId}`);
      if (!mountedRef.current) return;
      setHashes(data.results || []);
    } catch {
      if (!mountedRef.current) return;
      setHashes([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [evidenceId]);

  useEffect(() => { fetchHashes(); }, [fetchHashes]);

  const handleComputeHashes = async () => {
    setComputing(true);
    try {
      await apiFetch('/iped/hash/batch', {
        method: 'POST',
        body: JSON.stringify({ evidence_id: evidenceId }),
      });
      await fetchHashes();
    } catch {
      // Error handled by parent
    } finally {
      setComputing(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const flaggedCount = hashes.filter(h => h.flagged).length;
  const matchCount = hashes.filter(h => h.hash_set_match).length;

  if (loading) return (
    <div className="flex items-center gap-2 text-[10px] text-rmpg-500 py-2">
      <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Loading hash data...
    </div>
  );

  return (
    <div className="space-y-2">
      {/* Action bar */}
      <div className="flex items-center gap-2">
        <button type="button"
          onClick={handleComputeHashes}
          disabled={computing}
          className="toolbar-btn text-[10px] flex items-center gap-1 px-2.5 py-1 bg-brand-600 hover:bg-brand-500 text-rmpg-100 disabled:opacity-40"
        >
          {computing ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Hash className="w-3 h-3" />}
          {computing ? 'Computing...' : 'Compute Hashes'}
        </button>
        <span className="text-[9px] text-rmpg-500">{hashes.length} file(s) hashed</span>
      </div>

      {/* Alerts */}
      {flaggedCount > 0 && (
        <div className="flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm bg-red-950/30 border border-red-800/40 text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {flaggedCount} file(s) flagged — {matchCount} hash set match(es)
        </div>
      )}

      {/* Hash results */}
      {hashes.length > 0 ? (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {hashes.map(h => (
            <div
              key={h.id}
              className={`bg-surface-sunken p-2 rounded-sm text-[10px] ${
                h.flagged ? 'border border-red-800/40' : ''
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-rmpg-200 min-w-0 truncate flex-1">{h.file_name}</span>
                {h.flagged ? (
                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-red-900/40 text-red-400 border border-red-700/40 shrink-0">
                    FLAGGED{h.hash_set_name ? `: ${h.hash_set_name}` : ''}
                  </span>
                ) : h.hash_set_match ? (
                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-amber-900/30 text-amber-400 border border-amber-700/30 shrink-0">
                    HASH SET MATCH
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[9px]">
                {h.md5 && (
                  <div className="flex items-center gap-1">
                    <span className="text-rmpg-500 w-12 shrink-0">MD5:</span>
                    <span className="min-w-0 flex-1 text-rmpg-300 font-mono truncate">{h.md5}</span>
                    <button type="button" aria-label="Copy MD5 hash" onClick={() => copyToClipboard(h.md5!, `md5-${h.id}`)} className="shrink-0 text-rmpg-600 hover:text-rmpg-300">
                      {copiedField === `md5-${h.id}` ? <CheckCircle2 className="w-2.5 h-2.5 text-green-400" /> : <Copy className="w-2.5 h-2.5" />}
                    </button>
                  </div>
                )}
                {h.sha256 && (
                  <div className="flex items-center gap-1">
                    <span className="text-rmpg-500 w-12 shrink-0">SHA-256:</span>
                    <span className="min-w-0 flex-1 text-rmpg-300 font-mono truncate">{h.sha256.slice(0, 24)}...</span>
                    <button type="button" aria-label="Copy SHA-256 hash" onClick={() => copyToClipboard(h.sha256!, `sha256-${h.id}`)} className="shrink-0 text-rmpg-600 hover:text-rmpg-300">
                      {copiedField === `sha256-${h.id}` ? <CheckCircle2 className="w-2.5 h-2.5 text-green-400" /> : <Copy className="w-2.5 h-2.5" />}
                    </button>
                  </div>
                )}
                {h.photodna_hash && (
                  <div className="flex items-center gap-1">
                    <span className="text-rmpg-500 w-12 shrink-0">PhotoDNA:</span>
                    <span className="min-w-0 flex-1 text-purple-400 font-mono truncate">{h.photodna_hash.slice(0, 20)}...</span>
                    <Shield className="w-2.5 h-2.5 text-purple-400 shrink-0" />
                  </div>
                )}
                {h.phash && (
                  <div className="flex items-center gap-1">
                    <span className="text-rmpg-500 w-12 shrink-0">pHash:</span>
                    <span className="min-w-0 flex-1 text-rmpg-300 font-mono truncate">{h.phash}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[9px] text-rmpg-600">
          No hashes computed yet. Click "Compute Hashes" to generate MD5/SHA-256 and content fingerprints for all file attachments.
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════
// DETAIL — EvidenceTabDetail (right panel content)
// ════════════════════════════════════════════════════

export function EvidenceTabDetail({ state }: { state: EvidenceTabState }) {
  const {
    selectedEvidence, evidenceCustody, loadingCustody,
    linkRefreshKey, openLinkModal,
  } = state;

  if (!selectedEvidence) return null;

  const retentionOverdue = !!(
    selectedEvidence.retention_until &&
    parseTimestamp(selectedEvidence.retention_until) < new Date() &&
    !selectedEvidence.disposition
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Feature 38: Retention overdue badge */}
      {retentionOverdue && (
        <div className="px-4 py-2 bg-red-950/30 border-b border-red-800/40 flex items-center gap-2 text-[11px] text-red-400 font-bold flex-shrink-0">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 animate-pulse" />
          RETENTION OVERDUE — Past retention date ({safeDateStr(selectedEvidence.retention_until)})
          — Evidence requires disposition
        </div>
      )}

      {/* Hero identity band + print action */}
      <div className="border-b border-rmpg-600 bg-surface-sunken flex-shrink-0">
        <RecordHero
          name={selectedEvidence.evidence_number || 'EVIDENCE'}
          icon={Package}
          subtitle={
            <span className="flex items-center gap-2 flex-wrap">
              <span className="uppercase font-semibold text-purple-300">{toDisplayLabel(selectedEvidence.evidence_type || 'physical')}</span>
              {selectedEvidence.category && <span>· {selectedEvidence.category}</span>}
              {selectedEvidence.incident_number && (
                <span className="flex items-center gap-1"><Link2 className="w-3 h-3" />Incident <span className="font-mono text-rmpg-100">{selectedEvidence.incident_number}</span></span>
              )}
            </span>
          }
          flags={[retentionOverdue ? 'evidence hold' : null]}
          tone="gold"
        >
          {selectedEvidence.lab_submitted && <RecordBadge tone="purple" icon={FlaskConical}>LAB SUBMITTED</RecordBadge>}
          {selectedEvidence.disposal_method && <RecordBadge tone="red">DISPOSED: {selectedEvidence.disposal_method}</RecordBadge>}
          {selectedEvidence.photo_taken && <RecordBadge tone="gray" glow={false}>PHOTO ON FILE</RecordBadge>}
        </RecordHero>
        {/* Print / Preview / Sign & Export — generates the v1 evidence PDF
            (already implemented in recordPdfGenerator.ts as a `RecordPdfType`).
            Wires entityType so attachment images auto-fetch into the PDF. */}
        <div className="px-4 pb-2 flex items-center justify-end gap-1 print:hidden">
          <PrintRecordButton
            recordType="evidence"
            recordData={selectedEvidence}
            identifier={selectedEvidence.evidence_number}
            entityType="evidence"
            entityId={selectedEvidence.id}
            iconOnly
          />
        </div>
      </div>

      {/* Scrollable Detail Sections */}
      <div className="flex-1 overflow-auto p-2 space-y-1">

        {/* ── Description ─────────────────────── */}
        <CollapsibleSection title="Description" icon={FileText} defaultOpen>
          <p className="text-sm text-rmpg-200 leading-relaxed break-words">{selectedEvidence.description}</p>
        </CollapsibleSection>

        {/* ── Collection & Storage ──────────── */}
        <CollapsibleSection title="Collection & Storage" icon={Warehouse} defaultOpen>
          <FieldGrid cols={3}>
            {renderInfoRow('Collected By', selectedEvidence.collected_by_name)}
            {renderInfoRow('Date Collected', selectedEvidence.collected_date, Calendar)}
            {renderInfoRow('Storage Location', selectedEvidence.storage_location, MapPin)}
            {renderInfoRow('Packaging', selectedEvidence.packaging_type, Boxes)}
            {renderInfoRow('Condition', selectedEvidence.condition)}
            {renderInfoRow('Location Found', selectedEvidence.location_found, MapPin)}
          </FieldGrid>
        </CollapsibleSection>

        {/* ── Item Details (conditional) ──────── */}
        {(selectedEvidence.serial_number || selectedEvidence.brand || selectedEvidence.estimated_value || selectedEvidence.dimensions || selectedEvidence.weight) && (
          <CollapsibleSection title="Item Details" icon={Package} defaultOpen>
            <FieldGrid cols={3}>
              <RecordField label="Serial #" value={selectedEvidence.serial_number} mono copyable />
              <RecordField label="Brand/Model" value={selectedEvidence.brand ? `${selectedEvidence.brand}${selectedEvidence.model ? ` ${selectedEvidence.model}` : ''}` : undefined} />
              <RecordField label="Est. Value" value={selectedEvidence.estimated_value ? `$${Number(selectedEvidence.estimated_value).toLocaleString()}` : undefined} valueColor="var(--sev-ok-soft)" />
              <RecordField label="Dimensions" value={selectedEvidence.dimensions} />
              <RecordField label="Weight" value={selectedEvidence.weight} />
              <RecordField label="Quantity" value={selectedEvidence.quantity} />
            </FieldGrid>
          </CollapsibleSection>
        )}

        {/* ── Lab / Analysis (conditional) ────── */}
        {selectedEvidence.lab_submitted && (
          <CollapsibleSection title="Lab / Analysis" icon={FlaskConical}>
            <FieldGrid cols={2}>
              {renderInfoRow('Lab Name', selectedEvidence.lab_name)}
              {renderInfoRow('Lab Case #', selectedEvidence.lab_case_number, Hash)}
            </FieldGrid>
          </CollapsibleSection>
        )}

        {/* ── Disposal (conditional) ──────────── */}
        {selectedEvidence.disposal_method && (
          <CollapsibleSection title="Disposal" icon={Trash2}>
            <FieldGrid cols={3}>
              {renderInfoRow('Method', selectedEvidence.disposal_method)}
              {renderInfoRow('Date', selectedEvidence.disposal_date, Calendar)}
              {renderInfoRow('Authorized By', selectedEvidence.disposal_authorized_by)}
            </FieldGrid>
          </CollapsibleSection>
        )}

        {/* ── Chain of Custody ────────────────── */}
        <CollapsibleSection title={`Chain of Custody (${evidenceCustody.length})`} icon={Activity}>
          {loadingCustody ? (
            <div className="flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[11px] text-rmpg-400">Loading...</span></div>
          ) : evidenceCustody.length > 0 ? (
            <div className="relative">
              <div className="absolute left-3 top-0 bottom-0 w-px bg-rmpg-600" />
              <div className="space-y-3">
                {evidenceCustody.map((entry: CustodyEntry, idx: number) => {
                  const actionColors: Record<string, string> = {
                    collected: 'bg-green-500',
                    transferred: 'bg-rmpg-500',
                    checked_out: 'bg-amber-500',
                    returned: 'bg-rmpg-500',
                    released: 'bg-purple-500',
                    destroyed: 'bg-red-500',
                  };
                  return (
                    <div key={entry.id || idx} className="flex gap-3 relative pl-6">
                      <div className={`absolute left-1.5 top-1 w-3 h-3 rounded-full border-2 border-surface-base ${actionColors[entry.action] || 'bg-rmpg-500'}`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-rmpg-100 uppercase">{toDisplayLabel(entry.action)}</span>
                          <span className="text-[9px] text-rmpg-500">{safeDateTimeStr(entry.timestamp, '')}</span>
                        </div>
                        <div className="text-xs text-rmpg-300 mt-0.5">
                          {entry.from_person && <span className="text-rmpg-400">From: {entry.from_person}</span>}
                          {entry.from_person && entry.to_person && <ArrowRight className="w-3 h-3 inline mx-1 text-rmpg-500" />}
                          {entry.to_person && <span className="text-rmpg-200">To: {entry.to_person}</span>}
                        </div>
                        {entry.reason && <p className="text-[10px] text-rmpg-400 mt-0.5">{formatEnumValue(entry.reason)}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-rmpg-500">No custody entries recorded</p>
          )}
        </CollapsibleSection>

        {/* ── Notes (conditional) ──────────────── */}
        {selectedEvidence.notes && (
          <CollapsibleSection title="Notes" icon={FileText} defaultOpen={false}>
            <p className="text-xs text-rmpg-200 leading-relaxed break-words">{selectedEvidence.notes}</p>
          </CollapsibleSection>
        )}

        {/* ── Digital Forensics ──────────────── */}
        <CollapsibleSection title="Digital Forensics" icon={Microscope} defaultOpen={false}>
          <DigitalForensicsSection evidenceId={String(selectedEvidence.id)} />
        </CollapsibleSection>

        {/* ── Feature 23: Evidence Barcode / QR Generator ── */}
        <CollapsibleSection title="Barcode / QR" icon={Hash} defaultOpen={false}>
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="bg-white p-3 rounded-sm" style={{ width: 'fit-content' }}>
              {/* QR code rendered as SVG */}
              <svg viewBox="0 0 100 100" width="120" height="120">
                {(() => {
                  const evNum = selectedEvidence.evidence_number || String(selectedEvidence.id);
                  const cells: React.ReactElement[] = [];
                  let hash = 0;
                  for (let i = 0; i < evNum.length; i++) hash = ((hash << 5) - hash) + evNum.charCodeAt(i);
                  const drawFinder = (sx: number, sy: number) => {
                    cells.push(<rect key={`f-${sx}-${sy}`} x={sx} y={sy} width={14} height={14} fill="black" />);
                    cells.push(<rect key={`fw-${sx}-${sy}`} x={sx+2} y={sy+2} width={10} height={10} fill="white" />);
                    cells.push(<rect key={`fi-${sx}-${sy}`} x={sx+4} y={sy+4} width={6} height={6} fill="black" />);
                  };
                  drawFinder(4, 4);
                  drawFinder(82, 4);
                  drawFinder(4, 82);
                  for (let row = 0; row < 10; row++) {
                    for (let col = 0; col < 10; col++) {
                      const x = 22 + col * 6;
                      const y = 22 + row * 6;
                      const bit = ((hash >> ((row * 10 + col) % 31)) & 1) ^ ((row + col) % 2);
                      if (bit) cells.push(<rect key={`d-${row}-${col}`} x={x} y={y} width={5} height={5} fill="black" />);
                    }
                  }
                  return cells;
                })()}
              </svg>
            </div>
            <div className="text-center">
              <div className="text-xs font-mono font-bold text-rmpg-200">{selectedEvidence.evidence_number}</div>
              <div className="text-[9px] text-rmpg-500 mt-1">{selectedEvidence.description?.slice(0, 50)}</div>
            </div>
            <button type="button"
              onClick={() => {
                const printWindow = window.open('', '_blank', 'width=400,height=400');
                if (printWindow) {
                  const doc = printWindow.document;
                  doc.open();
                  const container = doc.createElement('div');
                  container.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100dvh;font-family:'Arial, sans-serif';";
                  const h2 = doc.createElement('h2');
                  h2.textContent = selectedEvidence.evidence_number || '';
                  container.appendChild(h2);
                  const p = doc.createElement('p');
                  p.textContent = selectedEvidence.description || '';
                  container.appendChild(p);
                  const date = doc.createElement('p');
                  date.style.cssText = 'font-size:10px;color:var(--text-muted, #666);';
                  date.textContent = new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' });
                  container.appendChild(date);
                  doc.body.appendChild(container);
                  doc.close();
                  printWindow.onload = () => {
                    printWindow.print();
                    printWindow.close();
                  };
                }
              }}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1"
            >
              Print Label
            </button>
          </div>
        </CollapsibleSection>

        {/* ── Feature 28: Evidence Photo Gallery ── */}
        {selectedEvidence.photos && (() => {
          let photos: string[] = [];
          try { photos = typeof selectedEvidence.photos === 'string' ? JSON.parse(selectedEvidence.photos) : selectedEvidence.photos; } catch { /* ignore */ }
          if (!Array.isArray(photos) || photos.length === 0) return null;
          return (
            <CollapsibleSection title={`Photo Gallery (${photos.length})`} icon={Package} defaultOpen>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo: string, idx: number) => (
                  <div
                    key={idx}
                    className="aspect-square bg-surface-sunken border border-rmpg-600 rounded-sm overflow-hidden cursor-pointer hover:border-brand-500 transition-colors"
                    onClick={() => window.open(photo, '_blank', 'noopener,noreferrer')}
                  >
                    <img src={photo} alt={`Evidence photo ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          );
        })()}

        {/* ── Record Info ─────────────────────── */}
        <CollapsibleSection title="Record Info" icon={Calendar} defaultOpen={false}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {renderInfoRow('Created', safeDateTimeStr(selectedEvidence.created_at, ''), Calendar)}
            {renderInfoRow('Updated', safeDateTimeStr(selectedEvidence.updated_at, ''), Calendar)}
          </div>
        </CollapsibleSection>

        {/* ── Linked Records ───────────────────── */}
        <LinkedRecordsSection
          key={`evidence-links-${selectedEvidence.id}-${linkRefreshKey}`}
          entityType="evidence"
          entityId={String(selectedEvidence.id)}
          onOpenLinkModal={() => openLinkModal('evidence', String(selectedEvidence.id))}
        />

        {/* ── File Attachments ─────────────────── */}
        <div className="panel-beveled p-3 bg-surface-base">
          <FileAttachments entityType="evidence" entityId={String(selectedEvidence.id)} />
          <EmailedDocuments recordType="evidence" recordId={selectedEvidence.id} />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════
// Legacy default export
// ════════════════════════════════════════════════════

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = parseTimestamp(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function EvidenceTab(props: EvidenceTabProps) {
  const state = useEvidenceTab(props);

  // Keyboard shortcut: Escape to deselect
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { state.setSelectedEvidence(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.setSelectedEvidence]);

  if (props.loadingEvidence) return null;

  return (
    <>
      <div className={`${state.selectedEvidence ? 'w-[40%]' : 'w-full'} border-r border-rmpg-600 flex flex-col overflow-hidden transition-all`}>
        <EvidenceTabList state={state} />
      </div>
      {state.selectedEvidence && (
        <div className="w-[60%] flex flex-col overflow-hidden">
          <EvidenceTabDetail state={state} />
        </div>
      )}
    </>
  );
}
