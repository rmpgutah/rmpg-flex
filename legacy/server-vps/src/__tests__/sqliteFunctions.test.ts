import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { registerSqliteFunctions } from '../models/sqliteFunctions';

describe('html_to_text', () => {
  const db = new Database(':memory:');
  registerSqliteFunctions(db);

  it('strips tags', () => {
    const r = db.prepare("SELECT html_to_text('<p>hello <b>world</b></p>') as t").get() as any;
    expect(r.t).toBe('hello world');
  });
  it('collapses whitespace', () => {
    const r = db.prepare("SELECT html_to_text('a\n\n\n   b') as t").get() as any;
    expect(r.t).toBe('a b');
  });
  it('decodes entities', () => {
    const r = db.prepare("SELECT html_to_text('<p>a &amp; b</p>') as t").get() as any;
    expect(r.t).toBe('a & b');
  });
  it('handles null', () => {
    const r = db.prepare('SELECT html_to_text(NULL) as t').get() as any;
    expect(r.t).toBe('');
  });
});
