// Extract entity references from inbound email subject + body so the poller
// can auto-link emails to existing case/incident/FI/citation/CFS records.
// The poller only writes auto-links for senders on the configured allowlist.

export interface EntityRef {
  type: 'case' | 'incident' | 'field_interview' | 'citation' | 'call';
  id: string;
}

const PATTERNS: Array<{ type: EntityRef['type']; rx: RegExp }> = [
  { type: 'case',            rx: /Case\s*#?\s*(\d{4}-[A-Z]{2}-\d{4,})/gi },
  { type: 'incident',        rx: /Incident\s*#?\s*(\d{2}-\d{4,})/gi },
  { type: 'field_interview', rx: /\b(FI-\d{2}-\d{5,})\b/gi },
  { type: 'citation',        rx: /Citation\s*#?\s*(\d{4}-\d{4,})/gi },
  { type: 'call',            rx: /CFS-(\d{4}-\d{4,})/gi },
];

export function extractEntityReferences(subject: string, body: string): EntityRef[] {
  const haystack = `${subject || ''}\n${body || ''}`;
  const seen = new Set<string>();
  const out: EntityRef[] = [];
  for (const { type, rx } of PATTERNS) {
    const pattern = new RegExp(rx.source, rx.flags);
    for (const m of haystack.matchAll(pattern)) {
      const id = m[1];
      const key = `${type}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type, id });
    }
  }
  return out;
}
