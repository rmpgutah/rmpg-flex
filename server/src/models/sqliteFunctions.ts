import type BetterSqlite3 from 'better-sqlite3';
import sanitizeHtml from 'sanitize-html';

// Strip HTML for FTS / preview. Uses sanitize-html (handles nested tags
// and bypass tricks like <scr<script>ipt>, decodes entities once) instead
// of the hand-rolled regex chain that flagged CodeQL js/bad-tag-filter
// (#2781) + js/double-escaping (#2782) — the prior code re-decoded entities
// after tag stripping, letting &amp;lt; round-trip into <.
export function registerSqliteFunctions(db: BetterSqlite3.Database): void {
  db.function('html_to_text', { deterministic: true }, (html: any) => {
    if (html == null) return '';
    const stripped = sanitizeHtml(String(html), {
      allowedTags: [],
      allowedAttributes: {},
    });
    return stripped.replace(/\s+/g, ' ').trim();
  });
}
