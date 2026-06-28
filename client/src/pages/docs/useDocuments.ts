// Thin data-access layer for the /api/docs document subsystem: a `docsApi`
// client object plus two PURE helpers (buildDocsQuery, canEditDocument).
// NOTE: despite the `use` prefix this exports NO React hook — it is a plain
// module of functions, kept at this name because downstream pages import it.
import { apiFetch } from '../../hooks/useApi';
import type { DocRecord, DocListItem, DocRevisionMeta, DocLink, DocRevisionBody } from '../../types';

export interface DocsQuery {
  mine?: boolean;
  status?: 'draft' | 'finalized' | (string & {});
  q?: string;
  targetType?: 'call' | 'incident';
  targetId?: number;
  limit?: number;
  offset?: number;
}

/** Pure: build the /docs query path from filters. */
export function buildDocsQuery(p: DocsQuery): string {
  const sp = new URLSearchParams();
  if (p.mine) sp.set('mine', 'true');
  if (p.status) sp.set('status', p.status);
  if (p.q) sp.set('q', p.q);
  if (p.targetType && p.targetId != null) {
    sp.set('target_type', p.targetType);
    sp.set('target_id', String(p.targetId));
  }
  if (p.limit != null) sp.set('limit', String(p.limit));
  if (p.offset != null) sp.set('offset', String(p.offset));
  const s = sp.toString();
  return s ? `/docs?${s}` : '/docs';
}

/** Pure: client-side mirror of the server edit gate (for button enablement). */
export function canEditDocument(
  doc: Pick<DocRecord, 'status' | 'owner_username'>,
  user?: { username?: string; role?: string } | null,
): boolean {
  if (!user) return false;
  if (doc.status === 'finalized') return false;
  if (user.role === 'admin' || user.role === 'manager') return true;
  return !!doc.owner_username && doc.owner_username === user.username;
}

export const docsApi = {
  list: (p: DocsQuery = {}) => apiFetch<{ data: DocListItem[] }>(buildDocsQuery(p)).then((r) => r.data),
  get: (id: number) => apiFetch<{ data: DocRecord }>(`/docs/${id}`).then((r) => r.data),
  create: (payload: { title: string; body?: string; links?: { target_type: 'call' | 'incident'; target_id: number }[] }) =>
    apiFetch<{ data: DocRecord }>('/docs', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data),
  save: (id: number, payload: { title?: string; body?: string; change_note?: string }) =>
    apiFetch<{ data: DocRecord }>(`/docs/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.data),
  finalize: (id: number) => apiFetch<{ data: DocRecord }>(`/docs/${id}/finalize`, { method: 'POST' }).then((r) => r.data),
  reopen: (id: number) => apiFetch<{ data: DocRecord }>(`/docs/${id}/reopen`, { method: 'POST' }).then((r) => r.data),
  revisions: (id: number) => apiFetch<{ data: DocRevisionMeta[] }>(`/docs/${id}/revisions`).then((r) => r.data),
  revision: (id: number, rev: number) =>
    apiFetch<{ data: DocRevisionBody }>(`/docs/${id}/revisions/${rev}`).then((r) => r.data),
  restore: (id: number, rev: number) =>
    apiFetch<{ data: DocRecord }>(`/docs/${id}/revisions/${rev}/restore`, { method: 'POST' }).then((r) => r.data),
  link: (id: number, target_type: 'call' | 'incident', target_id: number) =>
    apiFetch<{ data: DocLink[] }>(`/docs/${id}/links`, { method: 'POST', body: JSON.stringify({ target_type, target_id }) }).then((r) => r.data),
  unlink: (id: number, linkId: number) =>
    apiFetch<{ data: DocLink[] }>(`/docs/${id}/links/${linkId}`, { method: 'DELETE' }).then((r) => r.data),
  remove: (id: number) => apiFetch<{ success: boolean }>(`/docs/${id}`, { method: 'DELETE' }),
};
