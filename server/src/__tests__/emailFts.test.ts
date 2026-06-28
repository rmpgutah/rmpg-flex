import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { registerSqliteFunctions } from '../models/sqliteFunctions';

describe('email_cache_fts', () => {
  const db = new Database(':memory:');
  beforeAll(() => {
    registerSqliteFunctions(db);
    db.prepare(`CREATE TABLE email_cache (id INTEGER PRIMARY KEY, subject TEXT, from_address TEXT, from_name TEXT, body_html TEXT)`).run();
    db.prepare(`CREATE VIRTUAL TABLE email_cache_fts USING fts5(subject,from_address,from_name,body_text,content='email_cache',content_rowid='id',tokenize='porter unicode61')`).run();
    db.prepare(`CREATE TRIGGER email_cache_ai AFTER INSERT ON email_cache BEGIN
      INSERT INTO email_cache_fts(rowid,subject,from_address,from_name,body_text)
      VALUES (new.id, COALESCE(new.subject,''), COALESCE(new.from_address,''), COALESCE(new.from_name,''), html_to_text(new.body_html));
    END`).run();
  });

  it('matches term in body_html via html_to_text', () => {
    db.prepare(`INSERT INTO email_cache (subject,from_address,from_name,body_html) VALUES (?,?,?,?)`)
      .run('Re: Case', 'judge@ut.gov', 'Judge', '<p>Subpoena for <b>suspect</b> delivered</p>');
    const rows = db.prepare(`SELECT rowid FROM email_cache_fts WHERE email_cache_fts MATCH 'suspect'`).all();
    expect(rows.length).toBe(1);
  });

  it('matches on subject', () => {
    const rows = db.prepare(`SELECT rowid FROM email_cache_fts WHERE email_cache_fts MATCH 'subject:Case'`).all();
    expect(rows.length).toBeGreaterThan(0);
  });
});
