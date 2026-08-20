#!/usr/bin/env python3
"""Validate column identifiers in Worker SQL against the LIVE D1 schema.

    python3 scripts/check-schema-refs.py [src]

Requires `npx wrangler` to be authenticated (`npx wrangler login`) because it
reads the real schema from remote D1 — the whole point is to catch code that
disagrees with production, which a local migration replay cannot do.

WHY THIS EXISTS
---------------
Cloudflare D1 rejects an entire statement when one identifier is wrong, and
almost every call site in this codebase wraps its query in try/catch returning
[] or zeros. The result is that a query referencing a nonexistent column fails
*silently* — the feature renders empty, which looks like "no data yet". No
crash, no console error, nothing in a UI sweep.

The 2026-07-24 live audit found 19 such queries this way, including:
  - routing.ts        selected `location`          (live: location_address)
  - scheduleEngine.ts selected `incident_number`   (live: call_number)
  - personIntel       selected `full_name`/`date_of_birth` (live: first_name/last_name/dob)
  - reports.ts        selected `unit_number`       (live: call_sign)
`reports.ts:648`'s comment records an earlier instance of the same class
(response_time_sec vs response_time_seconds) that zeroed every dashboard tile.

SCOPE / KNOWN LIMITS
--------------------
Deliberately conservative: only analyses SQL it can attribute to exactly one
table, skipping joins, subqueries, aliased tables and template-interpolated
SQL. It inspects SELECT lists only. So its output is a FLOOR, not a ceiling —
bad columns in WHERE clauses, joins and dynamic SQL are NOT covered.

Exit code is 0 always; this is a report, not a gate. Verify each hit with
`npx wrangler d1 execute rmpg-flex --remote --command "SELECT <col> FROM <tbl> LIMIT 0"`
before changing code — a handful of hits are FTS5 functions (snippet/bm25) or
prose inside SQL comments.
"""
import json, re, subprocess, sys
from pathlib import Path

DB = 'rmpg-flex'
SRC = Path(sys.argv[1] if len(sys.argv) > 1 else 'src')


def live_ddl():
    out = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--json',
         '--command', "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL"],
        capture_output=True, text=True)
    try:
        data = json.loads(out.stdout)
    except json.JSONDecodeError:
        sys.exit(f"could not parse wrangler output — is `npx wrangler login` done?\n{out.stdout[:400]}{out.stderr[:400]}")
    if isinstance(data, dict) and 'error' in data:
        sys.exit(f"D1 error: {json.dumps(data['error'])[:300]}")
    return data[0]['results']


def parse_cols(ddl: str):
    """Column names from a CREATE TABLE body (top-level commas only)."""
    # Live DDL carries `-- ...` comments inside the column list; without
    # stripping them the first token of a segment is "--" and the real column
    # is silently dropped (which made this checker report true columns missing).
    ddl = re.sub(r'--[^\n]*', '', ddl)
    i = ddl.find('(')
    if i < 0:
        return set()
    depth, out, cur = 0, [], ''
    for ch in ddl[i + 1:]:
        if ch == '(':
            depth += 1
        elif ch == ')':
            if depth == 0:
                break
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur); cur = ''
        else:
            cur += ch
    out.append(cur)
    cols, SKIP = set(), ('primary', 'foreign', 'unique', 'check', 'constraint', 'key')
    for part in out:
        toks = part.strip().split()
        if not toks:
            continue
        first = toks[0].strip('"`[]')
        if first.lower() in SKIP:
            continue
        if re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', first):
            cols.add(first)
    return cols


KEYWORDS = set("""select from where and or not in is null as on join left right inner outer
group by order having limit offset union all distinct case when then else end count sum avg
min max coalesce cast integer text real blob asc desc like glob between exists insert into
values update set delete replace conflict ignore do nothing returning with recursive
strftime datetime date time julianday length lower upper substr instr trim ltrim rtrim
round abs ifnull nullif json json_extract json_array json_each group_concat total changes
last_insert_rowid random printf typeof true false default primary foreign key unique check
constraint autoincrement collate nocase using natural cross full pragma explain analyze
current_timestamp current_date current_time row_number rank dense_rank over partition
snippet bm25 highlight rowid matchinfo offsets
""".split())

STR = re.compile(r'`([^`]*?)`|\'((?:[^\'\\\n]|\\.)*)\'|"((?:[^"\\\n]|\\.)*)"', re.S)

schema = {}
for r in live_ddl():
    c = parse_cols(r['sql'])
    if c:
        schema[r['name']] = c

findings, files = [], list(SRC.rglob('*.ts'))
for path in files:
    src = path.read_text(errors='replace')
    for m in STR.finditer(src):
        sql = next((g for g in m.groups() if g), None)
        if not sql or not re.search(r'\bSELECT\b', sql, re.I):
            continue
        # Un-escape JS-escaped quotes BEFORE anything else. SQL embedded in a
        # single-quoted JS string writes its own literals as \'pass\', and the
        # literal-stripping regex below cannot match a quote preceded by a
        # backslash — so the literal survived and its contents tokenized as
        # column names. That produced fleet_fuel_log.Y / .m (from
        # strftime(\'%Y-%m\', …)) and fleet_inspections.pass (from
        # overall_result=\'pass\'): three false positives from one root cause.
        sql = sql.replace("\\'", "'").replace('\\"', '"')
        # Strip SQL comments — prose inside them tokenizes as fake identifiers.
        flat = ' '.join(re.sub(r'--[^\n]*', ' ', sql).split())
        froms = re.findall(r'\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)', flat, re.I)
        if len(set(froms)) != 1:
            continue
        table = froms[0]
        if table not in schema or re.search(r'\bJOIN\b', flat, re.I):
            continue
        if len(re.findall(r'\bSELECT\b', flat, re.I)) > 1 or '${' in sql:
            continue
        if re.search(r'\bFROM\s+' + table + r'\s+(?:AS\s+)?[a-z]{1,3}\b', flat, re.I):
            continue
        sel = re.search(r'\bSELECT\b(.*?)\bFROM\b', flat, re.I | re.S)
        if not sel:
            continue
        t = re.sub(r"'(?:[^'\\]|\\.)*'", ' ', sel.group(1))
        t = re.sub(r'\bAS\s+[A-Za-z_][A-Za-z0-9_]*', ' ', t, flags=re.I)
        t = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*', ' ', t)
        prev = None
        while prev != t:                       # implicit aliases: COUNT(*) n
            prev = t
            t = re.sub(r'\)\s*[A-Za-z_][A-Za-z0-9_]*', ')', t)
        for tok in re.findall(r'[A-Za-z_][A-Za-z0-9_]*', t):
            # `tok == table` — FTS5 auxiliary functions take the TABLE name as
            # their first argument (`bm25(intel_index)`,
            # `snippet(intel_index, 3, …)`), which is not a column reference.
            # Without this, every FTS5 search reads as a bad column ref; that
            # was 3 of the 4 remaining false positives (intel.ts, intelAi.ts,
            # intelQuery.ts).
            if tok.lower() in KEYWORDS or tok in schema[table] or tok == table:
                continue
            findings.append((str(path), src[:m.start()].count('\n') + 1, table, tok))

seen, uniq = set(), []
for f in findings:
    k = (f[0], f[2], f[3])
    if k not in seen:
        seen.add(k); uniq.append(f)

print(f"live schema: {len(schema)} tables | scanned {len(files)} .ts files")
print(f"suspect column refs: {len(uniq)}  (verify each before editing)\n")
for path, line, table, tok in sorted(uniq, key=lambda x: (x[0], x[1])):
    print(f"{path}:{line}  {table}.{tok}")
