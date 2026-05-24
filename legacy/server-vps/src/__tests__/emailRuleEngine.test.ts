import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { evaluateRulesForEmail, matchesConditions } from '../utils/emailRuleEngine';

describe('matchesConditions', () => {
  const email = { from_address: 'judge@ut.gov', subject: 'Subpoena: Case 2026-CS-1234', body_text: 'please respond', has_attachments: 0, importance: 'normal' };
  it('matches sender_regex', () => {
    expect(matchesConditions({ sender_regex: '@ut\\.gov$' }, email)).toBe(true);
  });
  it('rejects wrong sender_regex', () => {
    expect(matchesConditions({ sender_regex: '@example\\.com$' }, email)).toBe(false);
  });
  it('matches subject_regex', () => {
    expect(matchesConditions({ subject_regex: 'Subpoena' }, email)).toBe(true);
  });
  it('matches body_contains case-insensitive', () => {
    expect(matchesConditions({ body_contains: 'RESPOND' }, email)).toBe(true);
  });
  it('requires all conditions (AND)', () => {
    expect(matchesConditions({ sender_regex: '@ut\\.gov$', subject_regex: 'Subpoena' }, email)).toBe(true);
    expect(matchesConditions({ sender_regex: '@ut\\.gov$', subject_regex: 'Nope' }, email)).toBe(false);
  });
});

describe('evaluateRulesForEmail', () => {
  let db: Database.Database;
  beforeAll(() => {
    db = new Database(':memory:');
    db.prepare(`CREATE TABLE email_cache (id INTEGER PRIMARY KEY, owner_user_id INTEGER, graph_id TEXT, from_address TEXT, from_name TEXT, subject TEXT, body_html TEXT, has_attachments INTEGER, importance TEXT, is_flagged INTEGER DEFAULT 0, folder_id TEXT, categories TEXT DEFAULT '[]')`).run();
    db.prepare(`CREATE VIRTUAL TABLE email_cache_fts USING fts5(subject,from_address,from_name,body_text)`).run();
    db.prepare(`CREATE TABLE email_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, priority INTEGER, enabled INTEGER, conditions_json TEXT, actions_json TEXT, created_by INTEGER, created_at TEXT, updated_at TEXT, owner_user_id INTEGER)`).run();
    db.prepare(`CREATE TABLE email_rule_matches (id INTEGER PRIMARY KEY AUTOINCREMENT, email_cache_id INTEGER, rule_id INTEGER, executed_at TEXT, action_result TEXT)`).run();
    db.prepare(`CREATE TABLE email_links (id INTEGER PRIMARY KEY AUTOINCREMENT, email_graph_id TEXT, entity_type TEXT, entity_id TEXT, auto_linked INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT)`).run();
  });

  beforeEach(() => {
    // Reset rules + matches between tests so user-scoping assertions aren't polluted
    // by rules from earlier tests (e.g., user 7's flag rule matching user 7's later email).
    db.prepare('DELETE FROM email_rules').run();
    db.prepare('DELETE FROM email_rule_matches').run();
  });

  it('executes flag action on matching rule', async () => {
    db.prepare(`INSERT INTO email_cache (id, owner_user_id, graph_id, from_address, subject, body_html, has_attachments, importance) VALUES (1,7,'g1','judge@ut.gov','Subpoena','<p>x</p>',0,'normal')`).run();
    db.prepare(`INSERT INTO email_cache_fts(rowid, subject, from_address, from_name, body_text) VALUES (1,'Subpoena','judge@ut.gov','','x')`).run();
    db.prepare(`INSERT INTO email_rules (name, priority, enabled, conditions_json, actions_json, created_by, created_at, updated_at, owner_user_id) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('Flag subpoenas', 100, 1, JSON.stringify({ sender_regex: '@ut\\.gov$' }), JSON.stringify([{ type: 'flag' }]), 1, '2026-04-14', '2026-04-14', 7);
    await evaluateRulesForEmail(db, 1);
    const row = db.prepare('SELECT is_flagged FROM email_cache WHERE id = 1').get() as any;
    expect(row.is_flagged).toBe(1);
    expect(db.prepare('SELECT * FROM email_rule_matches WHERE email_cache_id = 1').get()).toBeTruthy();
  });

  it('does NOT execute another user\'s rule', async () => {
    // email owned by user 7
    db.prepare(`INSERT INTO email_cache (id, owner_user_id, graph_id, from_address, subject, body_html, has_attachments, importance) VALUES (2, 7, 'g2', 'judge@ut.gov', 'Subpoena', '<p>x</p>', 0, 'normal')`).run();
    db.prepare(`INSERT INTO email_cache_fts(rowid, subject, from_address, from_name, body_text) VALUES (2, 'Subpoena', 'judge@ut.gov', '', 'x')`).run();
    // rule owned by user 99 (different user)
    db.prepare(`INSERT INTO email_rules (name, priority, enabled, conditions_json, actions_json, created_by, created_at, updated_at, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('User 99 rule', 100, 1, JSON.stringify({ sender_regex: '@ut\\.gov$' }), JSON.stringify([{ type: 'flag' }]), 99, '2026-04-17', '2026-04-17', 99);
    await evaluateRulesForEmail(db, 2);
    const row = db.prepare('SELECT is_flagged FROM email_cache WHERE id = 2').get() as any;
    expect(row.is_flagged).toBe(0);  // NOT flagged — different user's rule shouldn't fire
  });

  it('executes a global rule (owner_user_id IS NULL) for any user', async () => {
    db.prepare(`INSERT INTO email_cache (id, owner_user_id, graph_id, from_address, subject, body_html, has_attachments, importance) VALUES (3, 8, 'g3', 'judge@ut.gov', 'Subpoena 2', '<p>y</p>', 0, 'normal')`).run();
    db.prepare(`INSERT INTO email_cache_fts(rowid, subject, from_address, from_name, body_text) VALUES (3, 'Subpoena 2', 'judge@ut.gov', '', 'y')`).run();
    db.prepare(`INSERT INTO email_rules (name, priority, enabled, conditions_json, actions_json, created_by, created_at, updated_at, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
      .run('Global subpoena flag', 100, 1, JSON.stringify({ sender_regex: '@ut\\.gov$' }), JSON.stringify([{ type: 'flag' }]), 1, '2026-04-17', '2026-04-17');
    await evaluateRulesForEmail(db, 3);
    const row = db.prepare('SELECT is_flagged FROM email_cache WHERE id = 3').get() as any;
    expect(row.is_flagged).toBe(1);  // flagged by global rule
  });
});
