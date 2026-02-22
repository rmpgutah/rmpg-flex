import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import EvidenceFormModal from '../../components/EvidenceFormModal';
import FileAttachments from '../../components/FileAttachments';
import PrintRecordButton from '../../components/PrintRecordButton';
import LinkedRecordsSection from '../../components/LinkedRecordsSection';
import type { CustodyEntry, RecordEntityType } from '../../types';

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
  setDeleteTarget: React.Dispatch<React.SetStateAction<{ type: 'person' | 'vehicle' | 'property' | 'evidence'; id: string; label: string } | null>>;
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
  handleArchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  handleUnarchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  fetchEvidence: () => Promise<void>;
  /** Increment to open the "New Evidence" modal from parent */
  openNewTrigger?: number;
}

// ── Component ──────────────────────────────────────

export default function EvidenceTab({
  searchQuery,
  setSearchQuery,
  showArchived,
  setError,
  evidence,
  loadingEvidence,
  setDeleteTarget,
  linkRefreshKey,
  openLinkModal,
  handleArchiveRecord,
  handleUnarchiveRecord,
  fetchEvidence,
  openNewTrigger,
}: EvidenceTabProps) {
  // Selected record for detail panel
  const [selectedEvidence, setSelectedEvidence] = useState<any | null>(null);
  const evidenceDetailRef = useRef<HTMLDivElement>(null);

  // Evidence custody
  const [evidenceCustody, setEvidenceCustody] = useState<CustodyEntry[]>([]);
  const [loadingCustody, setLoadingCustody] = useState(false);

  // Evidence modal (for editing)
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [editingEvidence, setEditingEvidence] = useState<any | null>(null);

  // Evidence standalone create modal
  const [evidenceCreateModalOpen, setEvidenceCreateModalOpen] = useState(false);

  // Open "New Evidence" modal when trigger changes from parent
  useEffect(() => {
    if (openNewTrigger && openNewTrigger > 0) {
      setEvidenceCreateModalOpen(true);
    }
  }, [openNewTrigger]);

  // Clear selection if the evidence was removed from the list (e.g. deleted/archived)
  useEffect(() => {
    if (selectedEvidence && !evidence.find((e: any) => e.id === selectedEvidence.id)) {
      setSelectedEvidence(null);
    }
  }, [evidence, selectedEvidence]);

  // ── Evidence custody fetch ──────────────────────
  useEffect(() => {
    if (selectedEvidence) {
      setLoadingCustody(true);
      const custody = selectedEvidence.chain_of_custody;
      if (Array.isArray(custody)) {
        setEvidenceCustody(custody);
        setLoadingCustody(false);
      } else if (typeof custody === 'string') {
        try {
          setEvidenceCustody(JSON.parse(custody));
        } catch {
          setEvidenceCustody([]);
        }
        setLoadingCustody(false);
      } else {
        setEvidenceCustody([]);
        setLoadingCustody(false);
      }
    } else {
      setEvidenceCustody([]);
    }
  }, [selectedEvidence?.id]);

  // Wrap archive/unarchive to also clear selection
  const handleArchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedEvidence(null);
    await handleArchiveRecord(type, id);
  };

  const handleUnarchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedEvidence(null);
    await handleUnarchiveRecord(type, id);
  };

  // ── Filtering ────────────────────────────────────

  const filteredEvidence = evidence.filter((ev) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (ev.evidence_number || '').toLowerCase().includes(q) ||
      (ev.description || '').toLowerCase().includes(q) ||
      (ev.evidence_type || '').toLowerCase().includes(q) ||
      (ev.serial_number || '').toLowerCase().includes(q) ||
      (ev.brand || '').toLowerCase().includes(q) ||
      (ev.storage_location || '').toLowerCase().includes(q) ||
      (ev.incident_number || '').toLowerCase().includes(q)
    );
  });

  // ── Helpers ──────────────────────────────────────

  const renderInfoRow = (label: string, value?: string | null, icon?: React.ElementType) => {
    if (!value) return null;
    const Icon = icon;
    return (
      <div className="flex items-start gap-2 text-xs">
        {Icon && <Icon className="w-3 h-3 text-rmpg-400 mt-0.5 flex-shrink-0" />}
        <span className="text-rmpg-400 min-w-[80px]">{label}:</span>
        <span className="text-rmpg-200">{value}</span>
      </div>
    );
  };

  // ── Render ───────────────────────────────────────

  if (loadingEvidence) return null;

  return (
    <>
      {/* Left: Evidence List */}
      <div className={`${selectedEvidence ? 'w-[40%]' : 'w-full'} border-r border-rmpg-600 flex flex-col overflow-hidden transition-all`}>
        {/* Search */}
        <div className="p-3 border-b border-rmpg-600">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400" />
            <input
              type="text"
              className="input-dark pl-9 w-full text-[11px]"
              placeholder="Search by evidence #, description, serial #, incident..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-white">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Evidence List */}
        <div className="flex-1 overflow-auto">
          {filteredEvidence.length === 0 && (
            <div className="text-center py-12">
              <Package className="w-8 h-8 text-rmpg-500 mx-auto mb-2" />
              <p className="text-sm text-rmpg-400">{searchQuery ? 'No evidence matches your search.' : 'No evidence records found.'}</p>
              <p className="text-xs text-rmpg-500 mt-1">Click "New Evidence" to add a record</p>
            </div>
          )}
          {filteredEvidence.map((ev: any) => {
            const hasLab = ev.lab_submitted;
            const isDisposed = !!ev.disposal_method;
            return (
              <div
                key={ev.id}
                onClick={() => setSelectedEvidence(selectedEvidence?.id === ev.id ? null : ev)}
                className={`
                  px-4 py-3 border-b border-rmpg-700/50 cursor-pointer transition-colors
                  ${selectedEvidence?.id === ev.id
                    ? 'bg-brand-900/20 border-l-2 border-l-brand-500'
                    : 'hover:bg-rmpg-700/30 border-l-2 border-l-transparent'
                  }
                `}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex-shrink-0 w-9 h-9 rounded flex items-center justify-center border ${
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
                      <span className="uppercase">{(ev.evidence_type || 'physical').replace(/_/g, ' ')}</span>
                      {ev.category && <span>{ev.category}</span>}
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
                      {!showArchived && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'evidence', id: ev.id, label: ev.evidence_number }); }}
                          className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                      {!showArchived && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleArchive('evidence', ev.id); }}
                          className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-amber-400 transition-colors"
                          title="Archive"
                        >
                          <Archive className="w-3 h-3" />
                        </button>
                      )}
                      {showArchived && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUnarchive('evidence', ev.id); }}
                          className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-green-400 transition-colors"
                          title="Unarchive"
                        >
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
      </div>

      {/* Right: Evidence Detail Panel */}
      {selectedEvidence && (
        <div ref={evidenceDetailRef} className="w-[60%] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-rmpg-600 bg-surface-sunken">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-green-400 font-mono">{selectedEvidence.evidence_number}</h2>
                <div className="flex items-center gap-3 mt-1 text-xs text-rmpg-300">
                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-purple-900/40 text-purple-300 border border-purple-600/40 uppercase">
                    {(selectedEvidence.evidence_type || 'physical').replace(/_/g, ' ')}
                  </span>
                  {selectedEvidence.category && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-rmpg-700 text-rmpg-300 border border-rmpg-600">
                      {selectedEvidence.category}
                    </span>
                  )}
                  {selectedEvidence.incident_number && (
                    <span className="flex items-center gap-1">
                      <Link2 className="w-3 h-3" />
                      Incident: <span className="font-mono text-white">{selectedEvidence.incident_number}</span>
                    </span>
                  )}
                </div>
              </div>
              <PrintRecordButton recordType="evidence" recordData={selectedEvidence} identifier={selectedEvidence?.evidence_number} entityType="evidence" entityId={selectedEvidence?.id} iconOnly title="Print evidence record" />
              <button onClick={() => setSelectedEvidence(null)} className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Status badges */}
            <div className="flex gap-2 mt-3">
              {selectedEvidence.lab_submitted && (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-purple-900/50 text-purple-400 border border-purple-700/50 flex items-center gap-1">
                  <FlaskConical className="w-3 h-3" /> LAB SUBMITTED
                </span>
              )}
              {selectedEvidence.disposal_method && (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-red-900/50 text-red-400 border border-red-700/50">
                  DISPOSED: {selectedEvidence.disposal_method}
                </span>
              )}
              {selectedEvidence.photo_taken && (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-900/50 text-blue-400 border border-blue-700/50">PHOTO ON FILE</span>
              )}
            </div>
          </div>

          {/* Detail Content */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* Description */}
            <div className="panel-beveled p-3 bg-surface-base">
              <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2">Description</h3>
              <p className="text-sm text-rmpg-200 leading-relaxed">{selectedEvidence.description}</p>
            </div>

            {/* Collection & Storage */}
            <div className="panel-beveled p-3 bg-surface-base">
              <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 flex items-center gap-1.5">
                <Warehouse className="w-3 h-3" /> Collection & Storage
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {renderInfoRow('Collected By', selectedEvidence.collected_by_name)}
                {renderInfoRow('Date Collected', selectedEvidence.collected_date, Calendar)}
                {renderInfoRow('Storage Location', selectedEvidence.storage_location, MapPin)}
                {renderInfoRow('Packaging', selectedEvidence.packaging_type, Boxes)}
                {renderInfoRow('Condition', selectedEvidence.condition)}
                {renderInfoRow('Location Found', selectedEvidence.location_found, MapPin)}
              </div>
            </div>

            {/* Item Details */}
            {(selectedEvidence.serial_number || selectedEvidence.brand || selectedEvidence.estimated_value || selectedEvidence.dimensions || selectedEvidence.weight) && (
              <div className="panel-beveled p-3 bg-surface-base">
                <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 flex items-center gap-1.5">
                  <Package className="w-3 h-3" /> Item Details
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {selectedEvidence.serial_number && (
                    <div className="text-xs"><span className="text-rmpg-400">Serial #:</span> <span className="text-rmpg-200 font-mono">{selectedEvidence.serial_number}</span></div>
                  )}
                  {selectedEvidence.brand && (
                    <div className="text-xs"><span className="text-rmpg-400">Brand/Model:</span> <span className="text-rmpg-200">{selectedEvidence.brand}{selectedEvidence.model ? ` ${selectedEvidence.model}` : ''}</span></div>
                  )}
                  {selectedEvidence.estimated_value && (
                    <div className="text-xs"><span className="text-rmpg-400">Est. Value:</span> <span className="text-green-400 font-bold">${Number(selectedEvidence.estimated_value).toLocaleString()}</span></div>
                  )}
                  {selectedEvidence.dimensions && (
                    <div className="text-xs"><span className="text-rmpg-400">Dimensions:</span> <span className="text-rmpg-200">{selectedEvidence.dimensions}</span></div>
                  )}
                  {selectedEvidence.weight && (
                    <div className="text-xs"><span className="text-rmpg-400">Weight:</span> <span className="text-rmpg-200">{selectedEvidence.weight}</span></div>
                  )}
                  {selectedEvidence.quantity && (
                    <div className="text-xs"><span className="text-rmpg-400">Quantity:</span> <span className="text-rmpg-200">{selectedEvidence.quantity}</span></div>
                  )}
                </div>
              </div>
            )}

            {/* Lab / Analysis */}
            {selectedEvidence.lab_submitted && (
              <div className="panel-beveled p-3 border-l-2 border-l-purple-600 bg-surface-base">
                <h3 className="text-[10px] text-purple-400 uppercase font-bold tracking-wider mb-3 flex items-center gap-1.5">
                  <FlaskConical className="w-3 h-3" /> Lab / Analysis
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {renderInfoRow('Lab Name', selectedEvidence.lab_name)}
                  {renderInfoRow('Lab Case #', selectedEvidence.lab_case_number, Hash)}
                </div>
              </div>
            )}

            {/* Disposal */}
            {selectedEvidence.disposal_method && (
              <div className="panel-beveled p-3 border-l-2 border-l-red-600 bg-surface-base">
                <h3 className="text-[10px] text-red-400 uppercase font-bold tracking-wider mb-3 flex items-center gap-1.5">
                  <Trash2 className="w-3 h-3" /> Disposal
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {renderInfoRow('Method', selectedEvidence.disposal_method)}
                  {renderInfoRow('Date', selectedEvidence.disposal_date, Calendar)}
                  {renderInfoRow('Authorized By', selectedEvidence.disposal_authorized_by)}
                </div>
              </div>
            )}

            {/* Chain of Custody */}
            <div className="panel-beveled p-3 bg-surface-base">
              <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 flex items-center gap-1.5">
                <Activity className="w-3 h-3" /> Chain of Custody ({evidenceCustody.length})
              </h3>
              {loadingCustody ? (
                <div className="flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin text-brand-400" /><span className="text-[11px] text-rmpg-400">Loading...</span></div>
              ) : evidenceCustody.length > 0 ? (
                <div className="relative">
                  <div className="absolute left-3 top-0 bottom-0 w-px bg-rmpg-600" />
                  <div className="space-y-3">
                    {evidenceCustody.map((entry: CustodyEntry, idx: number) => {
                      const actionColors: Record<string, string> = {
                        collected: 'bg-green-500',
                        transferred: 'bg-blue-500',
                        checked_out: 'bg-amber-500',
                        returned: 'bg-cyan-500',
                        released: 'bg-purple-500',
                        destroyed: 'bg-red-500',
                      };
                      return (
                        <div key={entry.id || idx} className="flex gap-3 relative pl-6">
                          <div className={`absolute left-1.5 top-1 w-3 h-3 rounded-full border-2 border-surface-base ${actionColors[entry.action] || 'bg-rmpg-500'}`} />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-white uppercase">{entry.action.replace(/_/g, ' ')}</span>
                              <span className="text-[9px] text-rmpg-500">{entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : ''}</span>
                            </div>
                            <div className="text-xs text-rmpg-300 mt-0.5">
                              {entry.from_person && <span className="text-rmpg-400">From: {entry.from_person}</span>}
                              {entry.from_person && entry.to_person && <ArrowRight className="w-3 h-3 inline mx-1 text-rmpg-500" />}
                              {entry.to_person && <span className="text-rmpg-200">To: {entry.to_person}</span>}
                            </div>
                            {entry.reason && <p className="text-[10px] text-rmpg-400 mt-0.5">{entry.reason}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-rmpg-500">No custody entries recorded</p>
              )}
            </div>

            {/* Notes */}
            {selectedEvidence.notes && (
              <div className="panel-beveled p-3 bg-surface-base">
                <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2">Notes</h3>
                <p className="text-xs text-rmpg-200 leading-relaxed">{selectedEvidence.notes}</p>
              </div>
            )}

            {/* Record Info */}
            <div className="panel-beveled p-3 bg-surface-base">
              <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2">Record Info</h3>
              <div className="grid grid-cols-2 gap-2">
                {renderInfoRow('Created', selectedEvidence.created_at ? new Date(selectedEvidence.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : null, Calendar)}
                {renderInfoRow('Updated', selectedEvidence.updated_at ? new Date(selectedEvidence.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : null, Calendar)}
              </div>
            </div>

            {/* Linked Records */}
            <LinkedRecordsSection
              key={`evidence-links-${selectedEvidence.id}-${linkRefreshKey}`}
              entityType="evidence"
              entityId={String(selectedEvidence.id)}
              onOpenLinkModal={() => openLinkModal('evidence', String(selectedEvidence.id))}
            />

            {/* File Attachments */}
            <div className="panel-beveled p-3 bg-surface-base">
              <FileAttachments entityType="evidence" entityId={String(selectedEvidence.id)} />
            </div>
          </div>
        </div>
      )}

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
    </>
  );
}
