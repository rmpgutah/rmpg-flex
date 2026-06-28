// Pure query-language parser for Intel Search. Turns analyst text with field
// operators into a structured ParsedQuery. Identifier auto-detection still
// happens server-side; this just lets analysts scope explicitly.
//
// Grammar: key:value or key:"quoted value". Known keys below; anything else
// (unknown key, or bare words) becomes free text.

export interface ParsedQuery {
  text: string;
  type?: string;
  name?: string;
  addr?: string;
  flags: string[];
  identifiers: { plate?: string; vin?: string; dob?: string; phone?: string; dl?: string; case?: string };
  since?: string;
  until?: string;
}

const KNOWN = new Set(['plate', 'vin', 'dob', 'phone', 'dl', 'case', 'name', 'addr', 'type', 'flag', 'since', 'until']);
// Matches  key:"quoted value"  OR  key:bareword  (bareword = no spaces)
const TOKEN = /(\w+):(?:"([^"]*)"|(\S+))/g;

export function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { text: '', flags: [], identifiers: {} };
  const leftover: string[] = [];
  let lastIndex = 0;
  const input = raw || '';

  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(input)) !== null) {
    // Capture any free text BETWEEN tokens.
    const between = input.slice(lastIndex, m.index).trim();
    if (between) leftover.push(between);
    lastIndex = TOKEN.lastIndex;

    const key = m[1].toLowerCase();
    const value = (m[2] !== undefined ? m[2] : m[3]) || '';
    if (!KNOWN.has(key)) { leftover.push(m[0]); continue; } // unknown operator → free text

    switch (key) {
      case 'type': out.type = value.toLowerCase(); break;
      case 'name': out.name = value; break;
      case 'addr': out.addr = value; break;
      case 'flag': if (value) out.flags.push(value.toLowerCase()); break;
      case 'since': out.since = value; break;
      case 'until': out.until = value; break;
      case 'plate': out.identifiers.plate = value; break;
      case 'vin': out.identifiers.vin = value; break;
      case 'dob': out.identifiers.dob = value; break;
      case 'phone': out.identifiers.phone = value; break;
      case 'dl': out.identifiers.dl = value; break;
      case 'case': out.identifiers.case = value; break;
    }
  }
  const tail = input.slice(lastIndex).trim();
  if (tail) leftover.push(tail);
  out.text = leftover.join(' ').trim();
  return out;
}

/** Flatten a ParsedQuery into the query-string params the API expects. */
export function toQueryParams(p: ParsedQuery): Record<string, string> {
  const qp: Record<string, string> = {};
  if (p.text) qp.q = p.text;
  if (p.type) qp.type = p.type;
  if (p.name) qp.name = p.name;
  if (p.addr) qp.addr = p.addr;
  if (p.flags.length) qp.flag = p.flags.join(',');
  if (p.since) qp.since = p.since;
  if (p.until) qp.until = p.until;
  for (const [k, v] of Object.entries(p.identifiers)) if (v) qp[k] = v;
  return qp;
}
