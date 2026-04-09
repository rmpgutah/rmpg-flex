// ============================================================
// RMPG Flex — Dash Cam Video Link Modal
// Attach a dash cam video to a call, incident, case, warrant,
// or citation for cross-referencing in the evidence chain.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { X, Link2, Loader2, Trash2, FileText, Phone, Briefcase, Gavel, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { safeDateStr } from '../utils/dateUtils';

interface VideoLink {
  id: number;
  video_id: number;
  entity_type: string;
  entity_id: number;
  linked_by: string;
  notes: string | null;
  created_at: string;
}

interface DashCamLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoId: number;
  videoTitle: string;
  canManage: boolean;
}

const ENTITY_TYPES = [
  { value: 'call', label: 'Call for Service', icon: Phone },
  { value: 'incident', label: 'Incident', icon: FileText },
  { value: 'case', label: 'Case', icon: Briefcase },
  { value: 'warrant', label: 'Warrant', icon: Gavel },
  { value: 'citation', label: 'Citation', icon: AlertTriangle },
] as const;

export default function DashCamLinkModal({ isOpen, onClose, videoId, videoTitle, canManage }: DashCamLinkModalProps) {
  const [links, setLinks] = useState<VideoLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityType, setEntityType] = useState('call');
  const [entityId, setEntityId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchLinks = useCallback(async () => {
    try {
      const data = await apiFetch<VideoLink[]>(`/fleet/dashcam-videos/${videoId}/links`);
      setLinks(Array.isArray(data) ? data : []);
    } catch {
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetchLinks();
    }
  }, [isOpen, fetchLinks]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entityId.trim()) return;
    const parsedEntityId = parseInt(entityId, 10);
    if (isNaN(parsedEntityId) || parsedEntityId < 1) { setError('Invalid record ID'); return; }
    setSubmitting(true);
    setError('');

    try {
      await apiFetch(`/fleet/dashcam-videos/${videoId}/links`, {
        method: 'POST',
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: parsedEntityId,
          notes: notes.trim() || undefined,
        }),
      });
      setEntityId('');
      setNotes('');
      fetchLinks();
    } catch (err: any) {
      setError(err?.message || 'Failed to add link');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (linkId: number) => {
    try {
      await apiFetch(`/fleet/dashcam-videos/${videoId}/links/${linkId}`, { method: 'DELETE' });
      fetchLinks();
    } catch {
      setError('Failed to remove link');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="w-full max-w-lg mx-4 panel-beveled bg-surface-base animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="panel-title-bar flex items-center gap-2">
          <Link2 className="w-3 h-3" style={{ color: '#888888' }} />
          <span>LINK VIDEO TO RECORDS</span>
          <button type="button"
            onClick={onClose}
            className="ml-auto hover:bg-white/10 p-0.5 transition-colors"
            aria-label="Close modal">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Video reference */}
          <div className="text-[10px] text-rmpg-400">
            Linking: <span className="text-rmpg-200 font-semibold">{videoTitle}</span>
          </div>

          {/* Add link form */}
          {canManage && (
            <form onSubmit={handleAdd} className="panel-inset p-3 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={entityType}
                  onChange={e => setEntityType(e.target.value)}
                  className="select-dark text-[10px] flex-1"
                >
                  {ENTITY_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={entityId}
                  onChange={e => setEntityId(e.target.value)}
                  placeholder="Record ID #"
                  className="input-dark text-[10px] w-28"
                  min={1}
                  required
                />
              </div>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="input-dark text-[10px] w-full"
                maxLength={200}
              />
              <button
                type="submit"
                disabled={submitting || !entityId.trim()}
                className="toolbar-btn toolbar-btn-primary w-full text-[10px] flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                Add Link
              </button>
            </form>
          )}

          {error && (
            <div className="text-[10px] text-red-400 bg-red-900/20 px-2 py-1 border border-red-700/30">
              {error}
            </div>
          )}

          {/* Existing links */}
          <div>
            <h4 className="text-[9px] font-bold text-rmpg-500 uppercase tracking-wider mb-2">
              Linked Records ({links.length})
            </h4>

            {loading ? (
              <div className="flex items-center justify-center py-4 gap-2">
                <Loader2 className="w-3 h-3 animate-spin text-rmpg-500" />
                <span className="text-[10px] text-rmpg-400">Loading...</span>
              </div>
            ) : links.length === 0 ? (
              <div className="text-center py-4">
                <Link2 className="w-5 h-5 mx-auto mb-1 text-rmpg-600" />
                <p className="text-[10px] text-rmpg-500">No linked records</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {links.map(link => {
                  const typeInfo = ENTITY_TYPES.find(t => t.value === link.entity_type);
                  const Icon = typeInfo?.icon || FileText;
                  return (
                    <div
                      key={link.id}
                      className="flex items-center gap-2 p-2 panel-beveled bg-surface-sunken"
                    >
                      <Icon className="w-3 h-3 text-brand-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-rmpg-200">
                          <span className="capitalize font-semibold">{link.entity_type}</span>
                          <span className="text-rmpg-400"> #{link.entity_id}</span>
                        </div>
                        {link.notes && (
                          <div className="text-[9px] text-rmpg-500 truncate">{link.notes}</div>
                        )}
                        <div className="text-[8px] text-rmpg-600">
                          by {link.linked_by} — {safeDateStr(link.created_at)}
                        </div>
                      </div>
                      {canManage && (
                        <button type="button"
                          onClick={() => handleRemove(link.id)}
                          className="toolbar-btn p-1 text-red-400 hover:text-red-300"
                          title="Remove link"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
