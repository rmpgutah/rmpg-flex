// ============================================================
// pagination.total must be the MATCHING count, not the page size
// ============================================================
// Three list endpoints in records.ts returned `total: rows.length`. That is
// the number of rows the LIMIT let through, so once a table outgrows its page
// the API reports a total equal to the limit and the client cannot tell the
// list was truncated. Harmless while persons=81 < limit 500; wrong the moment
// it isn't, and silently so.
//
// The subtle part is the BINDINGS: persons/vehicles push `limit` onto the same
// params array used by the WHERE clause, so a count query reusing that array
// would bind the limit as a predicate parameter and either error or silently
// filter. The handlers snapshot the bindings BEFORE the limit is appended;
// these tests pin that.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'src', 'routes', 'records.ts'), 'utf8');

// Comments in this file describe the very pattern under test, so strip them —
// otherwise an assertion can be satisfied by prose after the code is deleted.
const code = src
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .map((l) => l.replace(/\/\*[^*]*\*\//g, ' '))
  .join('\n');

describe('records.ts list pagination', () => {
  it('no handler reports the page size as the total', () => {
    expect(code).not.toContain('total: rows.length');
  });

  it('each of the three list endpoints issues a COUNT(*) for its total', () => {
    // persons/vehicles inline the table; evidence factors its joined FROM into
    // a `FROM` const so the page query and the count cannot drift apart.
    expect(code).toContain('SELECT COUNT(*) AS n FROM persons${whereClause}');
    expect(code).toContain('SELECT COUNT(*) AS n FROM vehicles_records${whereClause}');
    expect(code).toContain('SELECT COUNT(*) AS n ${FROM}${where}');
    // Matched by shape, not by literal: the guard that actually matters is the
    // `${FROM}${where}` reuse asserted above, so pinning every JOIN in the const
    // only made this test fail whenever a legitimately-needed join was added
    // (it did, when incidents was joined for incident_number).
    expect(code).toMatch(/const FROM = 'FROM evidence e LEFT JOIN [^']*'/);
    expect((code.match(/SELECT COUNT\(\*\) AS n /g) || []).length).toBe(3);
  });

  it('the count reuses the SAME where clause as the page query', () => {
    // A count with a different predicate is worse than no count — it reports a
    // total that does not correspond to the rows returned.
    expect(code).toContain('SELECT COUNT(*) AS n FROM persons${whereClause}');
    expect(code).toContain('SELECT COUNT(*) AS n FROM vehicles_records${whereClause}');
  });

  it('the count binds the predicate params WITHOUT the limit', () => {
    // whereParams is snapshotted before `params.push(limit)`. Passing `params`
    // instead would bind the limit into the WHERE clause.
    expect(code).toContain('const whereParams = [...params]');
    const countCalls = code.match(/SELECT COUNT\(\*\) AS n FROM (?:persons|vehicles_records)\$\{whereClause\}`, \.\.\.whereParams/g) || [];
    expect(countCalls.length, 'both keyed lists must bind whereParams').toBe(2);
  });

  it('still reports how many rows this page actually returned', () => {
    // Dropping `returned` would leave the client unable to detect truncation
    // by comparing it against total.
    expect((code.match(/returned: rows\.length/g) || []).length).toBe(3);
  });

  it('a failed count degrades to the page size rather than breaking the list', () => {
    expect((code.match(/totalRow\?\.n \?\? rows\.length/g) || []).length).toBe(3);
  });
});
