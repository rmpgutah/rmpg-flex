import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useAuth } from '../../../context/AuthContext';

interface EvidenceItem {
  id: number | string;
  evidence_id?: string;
  item_description?: string;
  description?: string;
  action_required?: string;
  action?: string;
  due_date?: string;
  status?: string;
}

function isOverdue(item: EvidenceItem): boolean {
  const due = item.due_date;
  if (!due) return false;
  return new Date(due).getTime() < Date.now();
}

function displayId(item: EvidenceItem): string {
  return String(item.evidence_id ?? item.id);
}

function displayDesc(item: EvidenceItem): string {
  return item.item_description ?? item.description ?? 'Evidence item';
}

function displayAction(item: EvidenceItem): string {
  return item.action_required ?? item.action ?? 'Review';
}

function formatDue(item: EvidenceItem): string {
  if (!item.due_date) return '';
  return new Date(item.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function DesktopEvidenceCoCWidget() {
  const { user } = useAuth();
  const [items, setItems] = useState<EvidenceItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const fetchEvidence = useCallback(async () => {
    try {
      const url = user?.id
        ? `/evidence/pending?officer_id=${user.id}`
        : '/evidence?status=pending&limit=10';
      const resp = await apiFetch<{ data: EvidenceItem[] } | EvidenceItem[]>(url);
      const rows: EvidenceItem[] = Array.isArray(resp) ? resp : ((resp as { data: EvidenceItem[] }).data ?? []);
      setItems(rows.slice(0, 10));
      setUnavailable(false);
    } catch {
      // Gracefully degrade — evidence endpoint may not exist
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchEvidence();
    const iv = setInterval(fetchEvidence, 15 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchEvidence]);

  const overdueCount = items?.filter(isOverdue).length ?? 0;

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 2,
        padding: '10px 14px',
        width: 240,
        maxHeight: 180,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          Evidence Actions Required
        </div>
        {overdueCount > 0 && (
          <span
            style={{
              background: 'var(--sev-warn)',
              color: '#fff',
              borderRadius: 2,
              fontSize: 10,
              fontWeight: 700,
              padding: '0 5px',
              lineHeight: '16px',
            }}
          >
            {overdueCount}
          </span>
        )}
      </div>

      {loading ? (
        <div>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ background: 'var(--surface-base)', borderRadius: 2, height: 22, marginBottom: 4 }} />
          ))}
        </div>
      ) : unavailable ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>No evidence data</div>
      ) : !items || items.length === 0 ? (
        <div className="flex items-center gap-2" style={{ color: 'var(--sev-ok)', fontSize: 11 }}>
          <span>✓</span>
          <span>No pending evidence actions</span>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {items.map(item => {
            const overdue = isOverdue(item);
            return (
              <div
                key={item.id}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  paddingBottom: 3,
                  marginBottom: 3,
                  fontSize: 10,
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)', fontSize: 10 }}>
                    #{displayId(item)}
                  </span>
                  <span style={{ color: overdue ? 'var(--sev-critical)' : 'var(--text-secondary)', fontSize: 10 }}>
                    {item.due_date ? formatDue(item) : ''}
                  </span>
                </div>
                <div style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayDesc(item)}
                </div>
                <div style={{ color: 'var(--sev-warn)', fontSize: 9, fontWeight: 600, marginTop: 1 }}>
                  {displayAction(item)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
