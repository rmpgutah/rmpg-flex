#!/usr/bin/env python3
"""
Find UNQUALIFIED column references in JOINed SQL that SQLite will reject as
"ambiguous column name".

WHY THIS EXISTS
---------------
scripts/check-schema-refs.py deliberately skips any query containing JOIN
(see its `re.search(r'\\bJOIN\\b', flat)` guard), because it cannot attribute a
bare column to one of several tables. That leaves every multi-table query
unaudited — and it is exactly where a different, equally silent bug lives.

A bare column that exists in TWO OR MORE of the joined tables is not a
mis-name: it is a hard SQLite error at execution time
("ambiguous column name: created_at"). Most call sites in this repo wrap
queries in `.catch(...)` or a `soft()` helper, so the error is swallowed and
the endpoint returns [] / 0 / a 500 with no clue why. Confirmed live
2026-07-31 on /api/fleet-viz/calls-per-gallon, which 500'd for every ?period
except `all` because its window clause said `created_at` while joining
units + users + calls_for_service — all three of which have that column.

MEASURED PRECISION — READ BEFORE ACTING ON OUTPUT
-------------------------------------------------
First run, 2026-07-31: **33 candidates reported, 2 actually broken.** The other
31 were legal, overwhelmingly because a bare column inside a SUBQUERY is scoped
to that subquery's own FROM, while this script flattens the whole statement into
one namespace. Making it subquery-aware needs a real SQL parser; until then the
false-positive rate is roughly 15:1 and that is ACCEPTABLE, because triage is
one cheap EXPLAIN per candidate and the alternative (no coverage at all) is what
let both live bugs survive.

The authoritative check is `EXPLAIN QUERY PLAN <sql>` against live D1: it does
full name resolution, executes nothing, and either errors or does not. That pass
over all 354 static multi-table SELECTs is what produced the 2 confirmed hits:
  - src/routes/admin.ts   -> no such table: personnel_certifications
  - src/routes/fleet.ts   -> ambiguous column name: status

DESIGN NOTES / DELIBERATE CONSERVATISM
-------------------------------------
This reports CANDIDATES, not verdicts. Every finding must be confirmed by
executing the real query against live D1 before any code is touched — an
earlier regex-only pass on this codebase produced 106 "findings" that were all
comment prose, so parsing alone is not evidence.

  * Backslash-escaped quotes are un-escaped FIRST. SQL embedded in a
    single-quoted JS string writes its literals as \\'pass\\', and a naive
    literal-strip cannot match a quote preceded by a backslash, so literal
    CONTENTS leak in and tokenize as fake column names. This is the same root
    cause that produced 3 false positives in check-schema-refs.py.
  * Interpolated SQL (`${...}`) is skipped: the shape is not knowable
    statically, so any conclusion would be a guess.
  * Only columns present in >= 2 of the involved tables are reported. A bare
    column present in exactly one is legal and idiomatic.
  * Aliases introduced by `AS x` are removed before tokenizing, so a computed
    output name is never mistaken for an input column.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

DB = 'rmpg-flex'
SRC = Path('src')

# Reserved words / functions that can appear where a column would. Kept
# generous: a missed keyword is a false positive a human must triage, whereas
# an over-broad list only loses coverage.
KEYWORDS = set("""
select from where and or not null as by group order limit offset having join left right inner outer full cross
on using distinct count sum avg min max total coalesce nullif cast int integer bigint real text blob numeric
case when then else end is like glob between in exists all any some union intersect except with recursive
values insert update set delete replace conflict ignore do nothing returning
strftime datetime date time julianday unixepoch length lower upper substr instr trim ltrim rtrim replace round
abs floor ceil ceiling random randomblob hex quote printf format typeof last_insert_rowid changes
current_timestamp current_date current_time true false default desc asc collate nocase rtrim binary
row_number rank dense_rank ntile lag lead first_value last_value nth_value over partition range rows preceding
following unbounded current row exclude ties others no if json json_extract json_array json_object json_group_array
json_group_object json_each json_tree iif max min pragma explain query plan analyze vacuum begin commit rollback
""".split())

STRING_LITERAL = re.compile(r'`([^`]*?)`|\'((?:[^\'\\\n]|\\.)*)\'|"((?:[^"\\\n]|\\.)*)"', re.S)
# FROM/JOIN <table> [AS] [alias]
TABLE_REF = re.compile(r'\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?', re.I)


def live_ddl():
    out = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--json',
         '--command', "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL"],
        capture_output=True, text=True)
    try:
        data = json.loads(out.stdout)
    except json.JSONDecodeError:
        sys.exit(f"could not parse wrangler output — is `npx wrangler login` done?\n"
                 f"{out.stdout[:300]}{out.stderr[:300]}")
    if isinstance(data, dict) and 'error' in data:
        sys.exit(f"D1 error: {json.dumps(data['error'])[:300]}")
    return data[0]['results']


def parse_cols(ddl: str):
    """Column names from a CREATE TABLE body. Skips table-level constraints."""
    m = re.search(r'\((.*)\)', ddl, re.S)
    if not m:
        return set()
    cols, skip = set(), ('primary', 'foreign', 'unique', 'check', 'constraint', 'key')
    depth, cur = 0, ''
    for ch in m.group(1):
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            parts = cur.strip().split()
            if parts and parts[0].lower() not in skip:
                cols.add(parts[0].strip('"`[]'))
            cur = ''
        else:
            cur += ch
    parts = cur.strip().split()
    if parts and parts[0].lower() not in skip:
        cols.add(parts[0].strip('"`[]'))
    return cols


def main():
    schema = {}
    for row in live_ddl():
        c = parse_cols(row['sql'])
        if c:
            schema[row['name']] = c

    findings = []
    files = sorted(SRC.rglob('*.ts'))
    for path in files:
        src = path.read_text(errors='replace')
        for m in STRING_LITERAL.finditer(src):
            raw = next((g for g in m.groups() if g), None)
            if not raw:
                continue
            # Un-escape BEFORE stripping literals (see module docstring).
            sql = raw.replace("\\'", "'").replace('\\"', '"')
            if not re.search(r'\bJOIN\b', sql, re.I) or not re.search(r'\bFROM\b', sql, re.I):
                continue
            if '${' in sql:
                continue  # interpolated — shape unknown, refuse to guess
            flat = ' '.join(re.sub(r'--[^\n]*', ' ', sql).split())

            tables, aliases = [], set()
            for tm in TABLE_REF.finditer(flat):
                tbl, alias = tm.group(1), tm.group(2)
                if tbl in schema:
                    tables.append(tbl)
                if alias and alias.lower() not in KEYWORDS:
                    aliases.add(alias)
            if len(set(tables)) < 2:
                continue

            body = flat
            body = re.sub(r"'(?:[^'\\]|\\.)*'", ' ', body)                       # string literals
            body = re.sub(r'\bAS\s+[A-Za-z_][A-Za-z0-9_]*', ' ', body, flags=re.I)  # output aliases
            body = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*', ' ', body)  # qualified refs

            for tok in set(re.findall(r'[A-Za-z_][A-Za-z0-9_]*', body)):
                if tok.lower() in KEYWORDS or tok in aliases or tok in schema:
                    continue
                owners = [t for t in set(tables) if tok in schema[t]]
                if len(owners) >= 2:
                    findings.append((str(path), src[:m.start()].count('\n') + 1, tok, sorted(owners)))

    seen, uniq = set(), []
    for f in findings:
        k = (f[0], f[2])
        if k not in seen:
            seen.add(k)
            uniq.append(f)

    print(f"live schema: {len(schema)} tables | scanned {len(files)} .ts files")
    print(f"ambiguous-column candidates: {len(uniq)}  (CONFIRM each by executing against live)\n")
    for path, line, tok, owners in sorted(uniq, key=lambda x: (x[0], x[1])):
        print(f"{path}:{line}  bare `{tok}` is in {len(owners)} joined tables: {', '.join(owners)}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
