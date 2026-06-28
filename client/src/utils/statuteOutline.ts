// ============================================================
// RMPG Flex — Utah statute outline parser (shared)
// ------------------------------------------------------------
// The law-book text is stored as a single run with inline markers
// ("…arm.(b) Terms…(2) An actor…"). This re-indents it into the canonical
// nested (1)(a)(i) legal outline. Extracted from LawBookPage so the on-screen
// reader and the printed PDF render the SAME structure (the printing feature
// must match the reading setup exactly).
// ============================================================

export interface OutlineSeg {
  depth: number;
  marker: string;
  text: string;
}

// Canonical Utah outline depth for a marker token: (1)→0 (a)→1 (i)→2 (A)→3 (I)→4
export function tokenDepth(tok: string): number {
  if (/^\d+$/.test(tok)) return 0;
  const isRoman = (s: string) => s.length > 0 && /^(x{0,3})(ix|iv|v?i{0,3})$/.test(s);
  if (/^[a-z]+$/.test(tok)) return isRoman(tok) ? 2 : 1; // (i)…→2, (a)…→1
  if (/^[A-Z]+$/.test(tok)) return isRoman(tok.toLowerCase()) ? 4 : 3; // (I)…→4, (A)…→3
  return 1;
}

// Split a statute body into its nested outline. A marker is STRUCTURAL (opens a
// subsection) when it sits at the start, right after a sentence boundary
// (. : ; or/and), or chains off another structural marker — references after a
// word ("Subsection (3)") are not.
export function parseOutline(text: string): OutlineSeg[] {
  const matches = [...text.matchAll(/\(([0-9]{1,3}|[A-Za-z]{1,3})\)/g)];
  if (matches.length === 0) return text.trim() ? [{ depth: 0, marker: '', text: text.trim() }] : [];

  const idxOf = (mm: RegExpMatchArray) => mm.index ?? 0;
  const endsAt = new Map<number, RegExpMatchArray>();
  for (const mm of matches) endsAt.set(idxOf(mm) + mm[0].length, mm);
  const structural = new Map<number, boolean>();
  for (const mm of matches) {
    const i = idxOf(mm);
    let s: boolean;
    if (i === 0) {
      s = true;
    } else if (text[i - 1] === ')') { // "(3)(b)" — chained, no space
      const prev = endsAt.get(i);
      s = prev ? !!structural.get(idxOf(prev)) : false;
    } else if (text[i - 1] === ' ' && text[i - 2] === ')') { // "(1) (a)" — chained with space
      const prev = endsAt.get(i - 1);
      s = prev ? !!structural.get(idxOf(prev)) : false;
    } else {
      const before = text.slice(0, i).replace(/\s+$/, '');
      s = /[.;:]$/.test(before) || /\b(or|and)$/i.test(before);
    }
    structural.set(i, s);
  }

  const open = matches.filter((mm) => structural.get(idxOf(mm)));
  if (open.length === 0) return [{ depth: 0, marker: '', text: text.trim() }];

  // One raw segment per structural marker, plus any lead prose before the first.
  const raw: OutlineSeg[] = [];
  const lead = text.slice(0, idxOf(open[0])).trim();
  if (lead) raw.push({ depth: 0, marker: '', text: lead });
  for (let k = 0; k < open.length; k++) {
    const mm = open[k];
    const start = idxOf(mm) + mm[0].length;
    const end = k + 1 < open.length ? idxOf(open[k + 1]) : text.length;
    raw.push({ depth: tokenDepth(mm[1]), marker: `(${mm[1]})`, text: text.slice(start, end).trim() });
  }

  // Fold "container" markers — a subsection like (3)(a)(i)… whose OWN text is
  // empty because its content lives entirely in deeper children — onto that
  // first child, so a pure container never lands on a line by itself. A trailing
  // empty container (no child to absorb it) is dropped.
  const segs: OutlineSeg[] = [];
  let prefix = '';
  for (let k = 0; k < raw.length; k++) {
    const seg = raw[k];
    if (seg.marker && !seg.text) { if (raw[k + 1]) prefix += seg.marker; continue; }
    segs.push({ ...seg, marker: prefix + seg.marker });
    prefix = '';
  }
  return segs;
}
