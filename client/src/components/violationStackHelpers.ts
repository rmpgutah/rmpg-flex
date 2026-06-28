export type OffenseLevel = 'Infraction' | 'Misdemeanor' | 'Felony';

export interface ViolationDraft {
  id: string;
  statute_id?: number;
  statute_citation: string;
  description: string;
  offense_level: OffenseLevel;
  fine_amount: number;
}

let nextSerial = 0;
export function newDraft(): ViolationDraft {
  // Client-side stable id. crypto.randomUUID is fine in modern browsers;
  // fall back to a serial + timestamp for jsdom/older runtimes.
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `v-${++nextSerial}-${Date.now()}`;
  return { id, statute_citation: '', description: '', offense_level: 'Infraction', fine_amount: 0 };
}

export function totalFineOf(drafts: ViolationDraft[]): number {
  return drafts.reduce(
    (sum, v) => sum + (Number.isFinite(v.fine_amount) ? v.fine_amount : 0),
    0,
  );
}
