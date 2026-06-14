// client/src/components/EmailedDocuments.tsx
// "Emailed Documents" — outbound PDFs/emails sent FROM this record, via
// GET /api/email/by-record. Mirrors the <FileAttachments entityType entityId>
// interface and sits beside it on record detail panels. Distinct from
// <LinkedEmailsSection> (inbound, Graph-linked correspondence).
import { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';

interface SentDoc {
  outboxId: number;
  status: 'pending' | 'sent' | 'failed';
  createdAt: string;
  sentAt: string | null;
  error: string | null;
  sentBy: string;
  to: string[];
  subject: string;
  attachmentName: string | null;
}
interface Props { recordType: string; recordId: number | string; title?: string; }

const STATUS: Record<SentDoc['status'], { label: string; cls: string }> = {
  sent:    { label: 'Sent',   cls: 'text-green-400 border-green-900' },
  pending: { label: 'Queued', cls: 'text-[#d4a017] border-[#5a4a10]' },
  failed:  { label: 'Failed', cls: 'text-red-400 border-red-900' },
};

export default function EmailedDocuments({ recordType, recordId, title = 'Emailed Documents' }: Props) {
  const [items, setItems] = useState<SentDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (recordId == null || recordId === '') return;
    setLoading(true);
    apiFetch<{ items: SentDoc[] }>(
      `/email/by-record?recordType=${encodeURIComponent(recordType)}&recordId=${encodeURIComponent(String(recordId))}`,
    )
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [recordType, recordId]);

  return (
    <div className="border border-[#232323] bg-[#0b0b0b]">
      <div className="px-3 py-2 text-[#d4a017] text-xs font-semibold uppercase border-b border-[#232323]">
        {title}{items.length ? ` (${items.length})` : ''}
      </div>
      {loading ? (
        <div className="px-3 py-2 text-gray-500 text-[11px]">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-3 py-2 text-gray-500 text-[11px] italic">No documents emailed from this record yet.</div>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-gray-400 text-[9px] uppercase border-b border-[#1a1a1a]">
              <th className="text-left px-3 py-[3px] font-semibold">When</th>
              <th className="text-left px-3 py-[3px] font-semibold">Sent by</th>
              <th className="text-left px-3 py-[3px] font-semibold">To</th>
              <th className="text-left px-3 py-[3px] font-semibold">Document</th>
              <th className="text-left px-3 py-[3px] font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const s = STATUS[it.status] ?? STATUS.pending;
              return (
                <tr key={it.outboxId} className="border-b border-[#141414]">
                  <td className="px-3 py-[2px] text-gray-300">{(it.sentAt || it.createdAt || '').replace('T', ' ').slice(0, 16)}</td>
                  <td className="px-3 py-[2px] text-gray-300">{it.sentBy}</td>
                  <td className="px-3 py-[2px] text-gray-300" title={it.to.join(', ')}>{it.to.join(', ') || '—'}</td>
                  <td className="px-3 py-[2px] text-gray-300">{it.attachmentName || it.subject || '—'}</td>
                  <td className="px-3 py-[2px]">
                    <span className={`inline-block border px-1 ${s.cls}`} title={it.error || ''}>{s.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
