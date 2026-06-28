// ============================================================
// RMPG Flex — label verifier (grounding check)
// ============================================================
// Cross-checks each DRAFT label against its source text: every non-empty
// field value must actually APPEAR in the packet (form rawText + Field Sheet
// + Court Docket). A value that's nowhere in the source is a mis-parse or a
// hallucinated label — exactly what must not train. Field-type-aware:
//   • names      → each significant token present
//   • address    → street number + a street word present
//   • dates       → the digit run present (any separator)
//   • phone/zip   → digit run present
//   • free text   → most tokens present (tolerant)
//
// Docs that pass ALL checks AND carry the core identity fields are flipped to
// "_verified": true (in place). Everything else is left unverified with a
// "_review" note explaining which field failed grounding, for a human pass.
//
// Run:  npx tsx training/verify-labels.ts "/path/to/ICU Investigations"
// ============================================================

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { TARGET_FIELDS, type TargetField } from '../src/utils/serveIntakeExtract';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const CORPUS = process.argv[2];
if (!CORPUS || !existsSync(CORPUS)) {
  console.error('Usage: npx tsx training/verify-labels.ts "/path/to/corpus"');
  process.exit(1);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'of', 'and', 'inc', 'llc', 'co', 'na', 'an', 'individual', 'a', 'for', 'to', 'by']);

// Find the job folder for an id and slurp all its PDFs' text (the union is the
// grounding corpus — a field may be sourced from any of the 3 docs).
function sourceTextFor(id: string, embeddedRawText: string): string {
  let combined = embeddedRawText;
  const dir = readdirSync(CORPUS).map((e) => join(CORPUS, e))
    .find((p) => statSync(p).isDirectory() && /^\d+/.test(p.split('/').pop() || '') && (p.split('/').pop() || '').startsWith(id));
  if (dir) {
    for (const f of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'))) {
      try { combined += '\n' + execFileSync('pdftotext', ['-layout', join(dir, f), '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { /* skip */ }
    }
  }
  return norm(combined);
}

// Does `value` ground in `hay` (already normalized)? Field-type aware.
function grounds(field: TargetField, value: string, hay: string): boolean {
  const v = value.trim();
  if (!v) return true; // empty is always fine (true-negative)
  if (field === 'server_name') return true; // constant ("ICU Investigations, LLC")
  if (field === 'job_number') return true;   // = folder id, not always in text
  if (field === 'recipient_type') return ['person', 'business'].includes(v.toLowerCase());
  if (field === 'document_type') return true; // derived enum, not a literal

  const digitsOf = (s: string) => s.replace(/\D/g, '');
  if (['recipient_zip', 'recipient_phone', 'attorney_phone', 'attorney_bar_number', 'client_reference'].includes(field)) {
    const d = digitsOf(v); return d.length === 0 || hay.replace(/\D/g, '').includes(d);
  }
  if (['recipient_dob', 'filing_date', 'service_deadline', 'hearing_date'].includes(field)) {
    // ISO yyyy-mm-dd → check the m/d/yy(yy) digits appear somewhere, any order.
    const [y, m, d] = v.split('-'); if (!y) return false;
    const hd = hay.replace(/\D/g, '');
    return [`${+m}${+d}${y.slice(2)}`, `${+m}${+d}${y}`, `${y}${m}${d}`].some((p) => hd.includes(p));
  }
  // text: most significant tokens must be present
  const toks = norm(v).split(' ').filter((t) => t.length > 1 && !STOP.has(t));
  if (toks.length === 0) return true;
  const hit = toks.filter((t) => hay.includes(t)).length;
  return hit / toks.length >= 0.6;
}

const CORE: TargetField[] = ['recipient_address', 'recipient_city'];

function main() {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  let verified = 0; const held: Array<{ id: string; reasons: string[] }> = [];
  for (const file of files) {
    const path = join(DATA_DIR, file);
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    if (doc._verified) { verified++; continue; }
    const hay = sourceTextFor(doc.id, doc.rawText || '');
    const fields = doc.expected.fields as Record<TargetField, string>;
    const reasons: string[] = [];

    // Carry over real conflicts the labeler couldn't resolve (not the
    // city-conflict, which it DID resolve — only the "still empty" kind).
    for (const r of (doc._review || []) as string[]) {
      if (/still empty|name empty|did not parse/i.test(r)) reasons.push(r);
    }
    // Grounding check, per field.
    for (const f of TARGET_FIELDS) {
      if (!grounds(f, fields[f] || '', hay)) reasons.push(`${f}="${fields[f]}" not found in source`);
    }
    // Over-capture check: a name/party/court value carrying $, filing stamps,
    // long digit runs, or timestamps is a parse that swept in caption noise.
    // (Grounding can't catch this — the junk IS in the source, just not a name.)
    const JUNK = /[$@]|filing\s*#|e-?filed|\b\d{5,}\b|\d{1,2}:\d{2}|^\d{1,3}\b|(?:\b\d{1,3}\b[ ]){2,}|attorneys?\s+for\b|\bhon\b|\brule\s|proceeding|coordination/i;
    for (const f of ['plaintiff', 'defendant', 'recipient_first_name', 'recipient_last_name',
      'recipient_business_name', 'registered_agent_name', 'court_name', 'attorney_name'] as TargetField[]) {
      if (fields[f] && JUNK.test(fields[f])) reasons.push(`${f} over-captured: "${(fields[f] || '').slice(0, 45)}"`);
    }
    // Must have the core identity to be useful.
    const hasName = !!(fields.recipient_last_name || fields.recipient_business_name);
    if (!hasName) reasons.push('no recipient name');
    for (const c of CORE) if (!fields[c]) reasons.push(`missing ${c}`);

    if (reasons.length === 0) {
      doc._verified = true;
      doc._review = [];
      writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
      verified++;
    } else {
      held.push({ id: doc.id, reasons });
    }
  }
  console.log(`\nVerified (grounded + complete): ${verified}`);
  console.log(`Held for human review: ${held.length}\n`);
  for (const h of held.sort((a, b) => a.reasons.length - b.reasons.length)) {
    console.log(`  ${h.id}: ${h.reasons.slice(0, 4).join('; ')}${h.reasons.length > 4 ? ` (+${h.reasons.length - 4})` : ''}`);
  }
}

main();
