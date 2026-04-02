import React, { useState, useEffect, useCallback } from 'react';
import {
  Link2,
  Plus,
  Trash2,
  UserCircle,
  Car,
  Building2,
  Package,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import type { RecordEntityType } from '../types';

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

const TYPE_ICON_MAP: Record<string, LucideIcon> = {
  person: UserCircle,
  vehicle: Car,
  property: Building2,
  evidence: Package,
};

/** Return the appropriate lucide icon component for a record entity type. */
export function getRecordTypeIcon(type: string): LucideIcon {
  return TYPE_ICON_MAP[type] || Package;
}

const TYPE_COLOR_MAP: Record<string, { text: string; bg: string; border: string }> = {
  person: {
    text: 'text-blue-400',
    bg: 'bg-blue-900/30',
    border: 'border-blue-700/50',
  },
  vehicle: {
    text: 'text-cyan-400',
    bg: 'bg-cyan-900/30',
    border: 'border-cyan-700/50',
  },
  property: {
    text: 'text-green-400',
    bg: 'bg-green-900/30',
    border: 'border-green-700/50',
  },
  evidence: {
    text: 'text-purple-400',
    bg: 'bg-purple-900/30',
    border: 'border-purple-700/50',
  },
};

const DEFAULT_COLOR = { text: 'text-rmpg-400', bg: 'bg-rmpg-800/30', border: 'border-rmpg-600/50' };

/** Return Tailwind class sets for a record entity type badge. */
export function getRecordTypeColor(type: string) {
  return TYPE_COLOR_MAP[type] || DEFAULT_COLOR;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Enriched link object returned by the API */
interface EnrichedLink {
  id: string;
  source_type: RecordEntityType;
  source_id: string;
  target_type: RecordEntityType;
  target_id: string;
  relationship: string;
  notes?: string;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  linked_type: RecordEntityType;
  linked_id: string;
  linked_label: string;
}

interface Props {
  entityType: RecordEntityType;
  entityId: string;
  onOpenLinkModal: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function LinkedRecordsSection({ entityType, entityId, onOpenLinkModal }: Props) {
  const [links, setLinks] = useState<EnrichedLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchLinks = useCallback(async () => {
    if (!entityType || !entityId) return;
    setLoading(true);
    try {
      const data = await apiFetch<EnrichedLink[]>(
        `/records/links?type=${encodeURIComponent(entityType)}&id=${encodeURIComponent(entityId)}`,
      );
      setLinks(data || []);
    } catch (err) {
      console.error('Failed to load linked records:', err);
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const handleDelete = useCallback(
    async (linkId: string) => {
      setDeletingId(linkId);
      try {
        await apiFetch(`/records/links/${linkId}`, { method: 'DELETE' });
        await fetchLinks();
      } catch (err) {
        console.error('Failed to delete link:', err);
      } finally {
        setDeletingId(null);
      }
    },
    [fetchLinks],
  );

  /* ---- Render ---------------------------------------------------- */

  return (
    <div className="panel-beveled p-3" style={{ background: '#0a0a0a' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Link2 size={12} className="text-rmpg-400" />
          <span className="text-[10px] text-rmpg-400 uppercase font-semibold tracking-wider">
            Linked Records
          </span>
          {links.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 bg-rmpg-700 text-rmpg-300 rounded-full font-bold">
              {links.length}
            </span>
          )}
        </div>
        <button
          type="button"
          className="toolbar-btn flex items-center gap-1 text-[10px]"
          onClick={onOpenLinkModal}
        >
          <Plus size={11} />
          Link Record
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 size={16} className="animate-spin text-rmpg-400" />
        </div>
      )}

      {/* Empty state */}
      {!loading && links.length === 0 && (
        <p className="text-[10px] text-rmpg-500 text-center py-3 italic">No linked records</p>
      )}

      {/* Link list */}
      {!loading && links.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {links.map((link) => {
            const Icon = getRecordTypeIcon(link.linked_type);
            const color = getRecordTypeColor(link.linked_type);
            const isDeleting = deletingId === link.id;

            return (
              <div
                key={link.id}
                className="flex items-center gap-2 py-1.5 px-2 hover:bg-rmpg-700/50 rounded-sm text-xs"
              >
                {/* Type icon */}
                <Icon size={14} className={color.text} />

                {/* Label */}
                <span className="text-rmpg-200 truncate flex-1">{link.linked_label}</span>

                {/* Type badge */}
                <span
                  className={`text-[9px] px-1.5 py-0.5 font-bold uppercase rounded-sm border ${color.text} ${color.bg} ${color.border}`}
                >
                  {link.linked_type}
                </span>

                {/* Relationship badge */}
                <span className="text-[9px] px-1.5 py-0.5 bg-rmpg-700 text-rmpg-300 border border-rmpg-600 rounded-sm">
                  {link.relationship}
                </span>

                {/* Delete button */}
                <button
                  type="button"
                  className="text-rmpg-500 hover:text-red-400 p-1 disabled:opacity-40"
                  disabled={isDeleting}
                  onClick={() => handleDelete(link.id)}
                  title="Remove link"
                  aria-label={`Remove link to ${link.linked_label}`}
                >
                  {isDeleting ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
