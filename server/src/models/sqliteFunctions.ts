import type BetterSqlite3 from 'better-sqlite3';

export function registerSqliteFunctions(db: BetterSqlite3.Database): void {
  db.function('html_to_text', { deterministic: true }, (html: any) => {
    if (html == null) return '';
    return String(html)
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  });
}
