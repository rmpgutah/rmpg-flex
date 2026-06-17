// Case activity formatting — pure mapping from a stored case_activity row
// (machine `action` key + JSON `detail`) to a human label + a theme color.
// Kept pure + side-effect-free so the Timeline tab stays dumb and this is
// unit-testable. Colors stay within the pure-black palette (no blue).

export interface CaseActivityRow {
  id?: number;
  action: string;
  actor_id?: number | null;
  actor_name?: string | null;
  detail?: string | Record<string, unknown> | null;
  created_at?: string | null;
}

export interface FormattedActivity {
  label: string;
  color: string;
}

const GREEN = '#22c55e';
const AMBER = '#f59e0b';
const GOLD = '#d4a017';
const GRAY = '#888888';
const RED = '#ef4444';
const PURPLE = '#8b5cf6';

/** Parse the detail blob whether it arrives as a JSON string or an object. */
function parseDetail(detail: CaseActivityRow['detail']): Record<string, any> {
  if (!detail) return {};
  if (typeof detail === 'object') return detail as Record<string, any>;
  try { return JSON.parse(detail); } catch { return {}; }
}

const ENTITY_SINGULAR: Record<string, string> = {
  properties: 'property',
  propertie: 'property',   // typo stored in older activity rows (was replace(/s$/, ''))
  vehicles: 'vehicle',
  persons: 'person',
  incidents: 'incident',
  warrants: 'warrant',
  citations: 'citation',
  cases: 'case',
  businesses: 'business',
  business: 'business',
  evidence: 'evidence',
};

/** Map an activity action + detail to a display label and color. */
export function formatActivity(action: string, detail?: CaseActivityRow['detail']): FormattedActivity {
  const d = parseDetail(detail);
  const rawEntity = d.entity ? String(d.entity).toLowerCase() : '';
  const entity = rawEntity ? (ENTITY_SINGULAR[rawEntity] || rawEntity.replace(/s$/, '')) : '';
  const idSuffix = d.entity_id ? ` #${d.entity_id}` : '';

  switch (action) {
    case 'case.created':
      return { label: `Case created${d.case_number ? ` (${d.case_number})` : ''}`, color: GREEN };
    case 'case.updated':
      return {
        label: `Case updated${Array.isArray(d.fields) && d.fields.length ? `: ${d.fields.join(', ')}` : ''}`,
        color: GRAY,
      };
    case 'status.changed':
      return { label: `Status → ${d.to ?? '?'}${d.disposition ? ` (${d.disposition})` : ''}`, color: AMBER };
    case 'review.submitted':
      return { label: 'Submitted for supervisor review', color: AMBER };
    case 'review.approved':
      return { label: 'Approved by supervisor', color: GREEN };
    case 'note.added':
      return { label: `Note added${d.note_type && d.note_type !== 'general' ? ` (${d.note_type})` : ''}`, color: PURPLE };
    case 'solvability.calculated':
      return { label: `Solvability calculated: ${d.score ?? '?'}/100`, color: GOLD };
    case 'link.added':
      return { label: `Linked ${entity || 'record'}${idSuffix}`, color: GOLD };
    case 'link.removed':
      return { label: `Unlinked ${entity || 'record'}${idSuffix}`, color: GRAY };
    case 'case.archived':
      return { label: 'Case archived', color: GRAY };
    case 'task.created':
      return { label: `Task created${d.title ? `: ${d.title}` : ''}`, color: GOLD };
    case 'task.updated':
      return { label: `Task updated${d.title ? `: ${d.title}` : ''}`, color: GRAY };
    case 'task.completed':
      return { label: `Task completed${d.title ? `: ${d.title}` : ''}`, color: GREEN };
    case 'task.deleted':
      return { label: `Task removed${d.title ? `: ${d.title}` : ''}`, color: RED };
    case 'case.linked':
      return { label: `Linked related case${d.related_case_number ? ` ${d.related_case_number}` : ''}`, color: GOLD };
    case 'case.unlinked':
      return { label: 'Removed related-case link', color: GRAY };
    default:
      // Unknown/future action keys degrade to a readable form of the key.
      return { label: action.replace(/[._]/g, ' '), color: GRAY };
  }
}
