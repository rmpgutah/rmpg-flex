// Rule-based suggestion engine for the Connections graph.
// NOT machine learning. NOT evidence. Heuristics only — the analyst
// must evaluate each suggestion. The API response carries a disclaimer.

export interface Suggestion {
  type: 'person';
  id: number;
  label: string;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
  rule: 'shared_phone' | 'shared_address' | 'co_occurrence' | 'same_plate_stops';
}

export function buildSuggestions(db: any, seedPersonId: number): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  const push = (s: Suggestion) => {
    const key = `${s.type}-${s.id}-${s.rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  const seed = db.prepare('SELECT id, first_name, last_name, phone, address, city FROM persons WHERE id = ?').get(seedPersonId) as any;
  if (!seed) return out;

  const labelFor = (p: any) => `${p.first_name || ''} ${p.last_name || ''}`.trim() || `Person #${p.id}`;

  // R1 — Shared phone
  if (seed.phone && String(seed.phone).trim().length > 0) {
    try {
      const rows = db.prepare(
        `SELECT id, first_name, last_name, phone FROM persons
         WHERE phone = ? AND phone IS NOT NULL AND TRIM(phone) != '' AND id != ?`
      ).all(seed.phone, seedPersonId) as any[];
      for (const r of rows) {
        push({
          type: 'person', id: r.id, label: labelFor(r),
          reason: `Shares phone ${seed.phone} with seed`,
          confidence: 'high', rule: 'shared_phone',
        });
      }
    } catch (err: any) { console.error('[Suggestions] R1:', err?.message); }
  }

  // R2 — Shared address (address + city, case-insensitive trim)
  if (seed.address && String(seed.address).trim().length > 0) {
    try {
      const rows = db.prepare(
        `SELECT id, first_name, last_name, address, city FROM persons
         WHERE LOWER(TRIM(address)) = LOWER(TRIM(?))
           AND LOWER(TRIM(COALESCE(city,''))) = LOWER(TRIM(COALESCE(?, '')))
           AND id != ?`
      ).all(seed.address, seed.city, seedPersonId) as any[];
      for (const r of rows) {
        push({
          type: 'person', id: r.id, label: labelFor(r),
          reason: `Shares address ${seed.address}${seed.city ? ', ' + seed.city : ''} with seed`,
          confidence: 'medium', rule: 'shared_address',
        });
      }
    } catch (err: any) { console.error('[Suggestions] R2:', err?.message); }
  }

  // R3 — Co-occurrence in >=2 incidents
  try {
    const rows = db.prepare(
      `SELECT p.id, p.first_name, p.last_name, COUNT(DISTINCT ip2.incident_id) as shared
       FROM incident_persons ip1
       JOIN incident_persons ip2 ON ip2.incident_id = ip1.incident_id AND ip2.person_id != ip1.person_id
       JOIN persons p ON p.id = ip2.person_id
       WHERE ip1.person_id = ?
       GROUP BY p.id
       HAVING shared >= 2`
    ).all(seedPersonId) as any[];
    for (const r of rows) {
      push({
        type: 'person', id: r.id, label: labelFor(r),
        reason: `${r.shared} shared incident${r.shared === 1 ? '' : 's'} with seed`,
        confidence: r.shared >= 3 ? 'high' : 'medium',
        rule: 'co_occurrence',
      });
    }
  } catch (err: any) { console.error('[Suggestions] R3:', err?.message); }

  // R4 — Same-plate stops via citations.vehicle_id
  try {
    const rows = db.prepare(
      `SELECT DISTINCT p.id, p.first_name, p.last_name, c2.vehicle_id
       FROM citations c1
       JOIN citations c2 ON c2.vehicle_id = c1.vehicle_id AND c2.person_id != c1.person_id
       JOIN persons p ON p.id = c2.person_id
       WHERE c1.person_id = ? AND c1.vehicle_id IS NOT NULL`
    ).all(seedPersonId) as any[];
    for (const r of rows) {
      push({
        type: 'person', id: r.id, label: labelFor(r),
        reason: `Cited in vehicle #${r.vehicle_id} alongside seed`,
        confidence: 'medium', rule: 'same_plate_stops',
      });
    }
  } catch (err: any) { console.error('[Suggestions] R4:', err?.message); }

  return out;
}
