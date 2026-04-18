import type BetterSqlite3 from 'better-sqlite3';
import sanitizeHtml from 'sanitize-html';

// Single-pass HTML entity decoder for FTS/preview text. Replaces each
// entity exactly once via regex match+lookup, so there's no cascade
// (e.g. `&amp;lt;` stays as `&lt;` — never round-trips to `<`). This
// preserves the CodeQL fix for js/double-escaping (#2782) while also
// decoding the common entities that sanitize-html leaves intact when
// allowedTags is empty.
const ENTITY_MAP: Record<string, string> = {
  '&amp;':  '&',
  '&lt;':   '<',
  '&gt;':   '>',
  '&quot;': '"',
  '&#39;':  "'",
  '&#x27;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};
function decodeCommonEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#39|#x27|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
}

// Strip HTML for FTS / preview. Uses sanitize-html (handles nested tags
// and bypass tricks like <scr<script>ipt>) instead of the hand-rolled
// regex chain that flagged CodeQL js/bad-tag-filter (#2781). We then
// single-pass decode common entities so downstream text consumers see
// readable content (e.g. "a & b" instead of "a &amp; b").
export function registerSqliteFunctions(db: BetterSqlite3.Database): void {
  db.function('html_to_text', { deterministic: true }, (html: any) => {
    if (html == null) return '';
    const stripped = sanitizeHtml(String(html), {
      allowedTags: [],
      allowedAttributes: {},
    });
    return decodeCommonEntities(stripped).replace(/\s+/g, ' ').trim();
  });
}
