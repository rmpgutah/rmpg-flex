// Maps a Client record onto CFS edit fields, FILL-BLANKS-ONLY.
// autofillFromClient() returns the candidate patch; applyFillBlanks() merges it
// into the current edit state without overwriting anything already entered.

export interface ClientRecord {
  id: string | number;
  name?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  address?: string;
  client_code?: string;
  contracts?: Array<{ id: number | string }>;
}

/** Candidate values to fill from the selected client. Adjust mappings to taste. */
export function autofillFromClient(client: ClientRecord): Record<string, string> {
  const patch: Record<string, string> = {};
  const set = (k: string, v: unknown) => { if (v != null && String(v).trim() !== '') patch[k] = String(v); };

  // Caller block
  set('caller_name', client.contact_name);
  set('caller_phone', client.contact_phone);
  set('caller_address', client.address);
  set('caller_relationship', 'client'); // default relationship when a client is the caller

  // PSO / Process-Service requestor block
  set('pso_requestor_name', client.contact_name);
  set('pso_requestor_phone', client.contact_phone);
  set('pso_requestor_email', client.contact_email);
  set('pso_billing_code', client.client_code);

  // Contract linkage — first/most-recent contract id, if hydrated
  if (Array.isArray(client.contracts) && client.contracts.length > 0) {
    set('contract_id', client.contracts[0].id);
  }
  return patch;
}

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

/** Merge patch into current, filling only blank keys. Pure — returns a new object. */
export function applyFillBlanks<T extends Record<string, any>>(current: T, patch: Record<string, string>): T {
  const next: Record<string, any> = { ...current };
  for (const [k, v] of Object.entries(patch)) if (isBlank(next[k])) next[k] = v;
  return next as T;
}
