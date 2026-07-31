#!/usr/bin/env python3
"""Deep column-identifier check of Worker SQL against the LIVE D1 schema.

    python3 scripts/check-schema-refs-deep.py [src]

Companion to check-schema-refs.py, which only inspects SELECT lists of
single-table, join-free, non-interpolated queries. That leaves the majority of
this codebase's SQL unchecked. This script covers the rest by using the parts
of SQL that stay unambiguous even in a big join:

  1. QUALIFIED refs (`v.officer_name`) — resolved via the statement's own
     FROM/JOIN alias map, so joins, WHERE, GROUP BY and ORDER BY are all in
     scope. Highest-precision signal available.
  2. INSERT INTO <table> (col, col, ...) column lists.
  3. UPDATE <table> SET col = ... assignment targets.
Unqualified identifiers in arbitrary clauses are intentionally out of scope —
see the NOTE in main(). Run check-schema-refs.py alongside this for those.

Template literals are handled by blanking `${...}` to a neutral token rather
than skipping the statement, which is what unlocked most of the new coverage.

Exit code is always 0 — this is a report, not a gate. Verify each hit with
`npx wrangler d1 execute rmpg-flex --remote --command "SELECT <col> FROM <tbl> LIMIT 0"`
before editing. Known benign hit classes: FTS5 virtual-table MATCH operands
(`x MATCH ?` where x is the table name), CTE names, and column names of tables
created at runtime by ensure*Schema() helpers that this script cannot see.
"""
import json, re, subprocess, sys
from pathlib import Path

DB = 'rmpg-flex'
SRC = Path(sys.argv[1] if len(sys.argv) > 1 else 'src')


def live_ddl():
    out = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command',
         "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL"],
        capture_output=True, text=True)
    try:
        data = json.loads(out.stdout)
    except json.JSONDecodeError:
        sys.exit(f"could not parse wrangler output — is `npx wrangler login` done?\n"
                 f"{out.stdout[:400]}{out.stderr[:400]}")
    if isinstance(data, dict) and 'error' in data:
        sys.exit(f"D1 error: {json.dumps(data['error'])[:300]}")
    return data[0]['results']


def parse_cols(ddl: str):
    """Column names from a CREATE TABLE body (top-level commas only)."""
    ddl = re.sub(r'--[^\n]*', '', ddl)          # live DDL carries -- comments
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
round abs ifnull nullif json json_extract json_array json_each json_group_array json_object
group_concat total changes last_insert_rowid random printf typeof true false default primary
foreign key unique check constraint autoincrement collate nocase using natural cross full
pragma explain analyze current_timestamp current_date current_time row_number rank dense_rank
over partition snippet bm25 highlight rowid matchinfo offsets match table if not temp view
trigger index begin commit rollback numeric boolean varchar char decimal double float
escape substring max min iif unixepoch abs sign lag lead first_value last_value cume_dist ntile
""".split())

# Statement-level table reference: FROM/JOIN/INTO/UPDATE <table> [AS] [alias]
TABLE_REF = re.compile(
    r'\b(?:FROM|JOIN|INSERT\s+INTO|INSERT\s+OR\s+\w+\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+'
    r'([A-Za-z_][A-Za-z0-9_]*)'
    r'(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?', re.I)

# Every SQL-bearing string literal, incl. template literals.
STR = re.compile(r'`([^`]*?)`|\'((?:[^\'\\\n]|\\.)*)\'|"((?:[^"\\\n]|\\.)*)"', re.S)
SQL_START = re.compile(r'\b(SELECT|INSERT\s+INTO|INSERT\s+OR|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\b', re.I)


def strip_interpolations(s: str) -> str:
    """Remove `${...}` with brace counting. A naive [^{}]* pattern leaves the
    tail of any interpolation containing an object literal or nested template,
    and that leaked JS then tokenizes as dozens of fake column names."""
    out, i = [], 0
    while i < len(s):
        if s.startswith('${', i):
            depth, i = 1, i + 2
            while i < len(s) and depth:
                if s[i] == '{':
                    depth += 1
                elif s[i] == '}':
                    depth -= 1
                i += 1
            out.append(' ? ')
        else:
            out.append(s[i]); i += 1
    return ''.join(out)


def flatten(sql: str) -> str:
    """Normalise a JS SQL literal: drop comments, blank interpolations/strings."""
    s = strip_interpolations(sql)
    s = re.sub(r'--[^\n]*', ' ', s)               # line comments
    s = re.sub(r'/\*.*?\*/', ' ', s, flags=re.S)  # block comments
    s = re.sub(r"'(?:[^'\\]|\\.)*'", " '' ", s)   # inner single-quoted literals
    s = re.sub(r'\\"(?:[^"\\]|\\.)*\\"', ' "" ', s)  # escaped double-quoted literals
    return ' '.join(s.split())


def main():
    schema = {}
    for r in live_ddl():
        cols = parse_cols(r['sql'])
        if cols:
            schema[r['name']] = cols

    findings, files = [], sorted(SRC.rglob('*.ts'))
    for path in files:
        src = path.read_text(errors='replace')
        for m in STR.finditer(src):
            raw = next((g for g in m.groups() if g), None)
            if not raw or not SQL_START.search(raw):
                continue
            flat = flatten(raw)
            line = src[:m.start()].count('\n') + 1

            # Alias map for this statement. Unknown tables (runtime-created,
            # CTEs) map to None so their qualified refs are skipped, not
            # falsely blamed on another table.
            aliases, tables = {}, []
            for tm in TABLE_REF.finditer(flat):
                tbl, alias = tm.group(1), tm.group(2)
                known = tbl in schema
                if known and tbl not in tables:
                    tables.append(tbl)
                aliases[tbl.lower()] = tbl if known else None
                if alias and alias.lower() not in KEYWORDS:
                    aliases[alias.lower()] = tbl if known else None
            if not tables:
                continue

            def report(table, col):
                if col.lower() in KEYWORDS or col in schema[table]:
                    return
                findings.append((str(path), line, table, col))

            # 1. Qualified refs anywhere in the statement.
            for qm in re.finditer(r'\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b', flat):
                tbl = aliases.get(qm.group(1).lower())
                if tbl:
                    report(tbl, qm.group(2))

            # 2. INSERT column lists.
            for im in re.finditer(
                    r'\b(?:INSERT(?:\s+OR\s+\w+)?|REPLACE)\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)',
                    flat, re.I):
                tbl = im.group(1)
                if tbl in schema:
                    for col in re.findall(r'[A-Za-z_][A-Za-z0-9_]*', im.group(2)):
                        report(tbl, col)

            # 3. UPDATE ... SET assignment targets.
            for um in re.finditer(r'\bUPDATE\s+([A-Za-z_][A-Za-z0-9_]*)\s+SET\b(.*?)(?:\bWHERE\b|$)',
                                  flat, re.I | re.S):
                tbl = um.group(1)
                if tbl in schema:
                    for col in re.findall(r'(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=', um.group(2)):
                        report(tbl, col)

            # NOTE: unqualified identifiers in arbitrary clauses are deliberately
            # NOT checked here. Implicit result aliases (`COUNT(*) n`), CTE
            # column names and SQLite date modifiers are indistinguishable from
            # column refs without a real parser, and they drowned the real hits
            # ~60:1 when tried. check-schema-refs.py covers the one case where
            # unqualified refs ARE safely attributable (single-table SELECT
            # lists); run both scripts.

    seen, uniq = set(), []
    for f in findings:
        k = (f[0], f[2], f[3])
        if k not in seen:
            seen.add(k); uniq.append(f)

    print(f"live schema: {len(schema)} tables | scanned {len(files)} .ts files")
    print(f"suspect column refs: {len(uniq)}  (verify each before editing)\n")
    for path, line, table, col in sorted(uniq, key=lambda x: (x[0], x[1])):
        print(f"{path}:{line}  {table}.{col}")


if __name__ == '__main__':
    main()
