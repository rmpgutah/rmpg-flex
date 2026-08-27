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
  4. Unqualified refs in the SELECT list of a single-table, join-free statement.
  5. Unqualified refs in the WHERE / GROUP BY / ORDER BY / HAVING of such a
     statement, after subtracting the result aliases the statement itself
     invents (`AS x`, `COUNT(*) n`) — without that subtraction this rule is
     ~60:1 noise; with it, it is the only rule that sees a bad column in a
     WHERE clause, where a wrong name returns zero rows instead of erroring.
  6. Unqualified refs in a MULTI-TABLE join: reported when the name exists on
     NONE of the participating tables. Which table owns it is ambiguous; that
     it resolves nowhere is not.
This supersedes check-schema-refs.py, whose regex-based literal extraction
mis-pairs quotes across a file and silently drops whole queries.

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
nulls last excluded escape substring max min iif unixepoch abs sign lag lead first_value last_value cume_dist ntile
""".split())

# Statement-level table reference: FROM/JOIN/INTO/UPDATE <table> [AS] [alias]
TABLE_REF = re.compile(
    r'\b(?:FROM|JOIN|INSERT\s+INTO|INSERT\s+OR\s+\w+\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+'
    r'([A-Za-z_][A-Za-z0-9_]*)'
    r'(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?', re.I)

SQL_START = re.compile(r'\b(SELECT|INSERT\s+INTO|INSERT\s+OR|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\b', re.I)

# Tokens that appear in JavaScript but never in SQL. A backstop for lexer
# desync: this file lexes JS well enough for string extraction, but not
# perfectly (regex literals and JSX can resync it mid-string), and a desynced
# scanner yields a chunk of CODE that happens to contain the word UPDATE. That
# chunk then tokenizes as dozens of imaginary columns -- hr.ts reported ten,
# including "await" and "const". Cheaper and more robust than a full JS parser.
NOT_SQL = re.compile(r'=>|\bc\.json\(|\b(?:const|let|var|function|await|async|return|typeof'
                     r'|catch|=== |!== )\b|\breq\.|\bconsole\.')


# JavaScript expressions sitting INSIDE a SQL literal with NO ${} around them.
# D1 then receives the literal source text and throws a syntax error, which the
# call site's catch turns into []. fleet.ts's emissions-tests query shipped
# `v.year <= new Date().getFullYear() - 4` this way and never once returned a
# row. Checked AFTER stripping interpolations, since JS inside ${} is correct.
# `||` is excluded: in SQL it is string concatenation, not a JS or.
JS_IN_SQL = re.compile(r'\bnew\s+Date\s*\(|\.getFullYear\s*\(|\.toISOString\s*\('
                       r'|\bMath\.\w+\s*\(|\?\?|\.length\b|\.map\s*\(|\bJSON\.\w+\s*\(')


# A `/` starts a REGEX (not division) when the previous significant token
# cannot end an expression. Getting this wrong is not cosmetic: hr.ts line 179
# holds /[",\n\r]/ , whose `"` was read as a string opener. That desynced the
# scanner, and because each mispairing cascades, 21 of 28 SQL-bearing literals
# in that file came out as garbage -- its ~81 statements were never checked.
REGEX_PREV_OK = re.compile(r'(?:[(,=:\[!&|?{};+\-*%~^<>]|\b(?:return|typeof|instanceof|in|of'
                           r'|new|delete|void|do|else|case|yield|await))\s*$')


def _regex_end(src: str, i: int) -> int:
    """Index just past a regex literal starting at src[i] == '/', or -1."""
    j, in_class = i + 1, False
    while j < len(src):
        c = src[j]
        if c == '\\':
            j += 2; continue
        if c == '\n':
            return -1                 # regex literals cannot span lines
        if c == '[':
            in_class = True
        elif c == ']':
            in_class = False
        elif c == '/' and not in_class:
            j += 1
            while j < len(src) and src[j].isalpha():   # flags
                j += 1
            return j
        j += 1
    return -1


def iter_literals(src: str):
    """Yield (offset, text) for every JS string/template literal.

    A real lexer with an explicit state STACK, not a regex and not a depth
    counter. Two earlier designs both under-reported badly:

      1. A regex alternation over `...` / '...' / "..." pairs quotes by POSITION
         across the whole file, so one stray backtick shifts every later pairing
         and silently swallows whole queries.
      2. Tracking `${` nesting with a plain integer ignores quotes INSIDE the
         interpolation, so a brace in a quoted string -- `${cond ? '{' : ''}` --
         or simply a nested template desynchronises everything downstream. In
         src/routes/hr.ts that left 22 of 29 extracted literals as garbage and
         the file's ~81 SQL statements effectively UNSCANNED.

    The stack makes interpolations first-class: inside `${...}` we are back in
    code, where strings, templates and braces all nest properly.
    """
    i, n = 0, len(src)
    stack = []            # 'tmpl' | 'brace'
    lit_start = None      # offset where the current top-level literal began
    while i < n:
        ch = src[i]
        in_code = not stack or stack[-1] == 'brace'

        if in_code and ch == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            i = n if j < 0 else j + 1
            continue
        if in_code and ch == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue

        if in_code and ch == '/' and REGEX_PREV_OK.search(src[max(0, i - 40):i]):
            end = _regex_end(src, i)
            if end > 0:
                i = end
                continue

        if in_code and ch in '\'"':
            # Simple quoted string: cannot contain a newline, so an unterminated
            # one is a lexing error we recover from rather than run away with.
            q, start = ch, i + 1
            i += 1
            while i < n and src[i] != q:
                if src[i] == '\\':
                    i += 2; continue
                if src[i] == '\n':
                    break
                i += 1
            if not stack:
                yield start, src[start:i]
            i += 1
            continue

        if in_code and ch == '`':
            if not stack:
                lit_start = i + 1
            stack.append('tmpl')
            i += 1
            continue

        if stack and stack[-1] == 'tmpl':
            if ch == '\\':
                i += 2; continue
            if ch == '$' and i + 1 < n and src[i + 1] == '{':
                stack.append('brace'); i += 2; continue
            if ch == '`':
                stack.pop()
                if not stack and lit_start is not None:
                    yield lit_start, src[lit_start:i]
                    lit_start = None
                i += 1
                continue
            i += 1
            continue

        if stack and stack[-1] == 'brace':
            if ch == '{':
                stack.append('brace')
            elif ch == '}':
                stack.pop()
            i += 1
            continue

        i += 1


# A quoted string inside an interpolation that looks like a SQL fragment rather
# than JS: bare/qualified identifiers, commas, dots, parens, AS/NULL/DESC etc.
# Single character-class avoids alternation ambiguity (ReDoS) while matching the
# same set of SQL-like characters as the previous multi-branch pattern.
SQL_FRAGMENT = re.compile(
    r'^[\s(]*(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_\s,().*=<>!|+\-]*$',
    re.I)


def strip_interpolations(s: str) -> str:
    """Replace each `${...}` with the SQL-looking string literals inside it.

    Brace counting, because a naive [^{}]* pattern leaves the tail of any
    interpolation containing an object literal or nested template, and that
    leaked JS then tokenizes as dozens of fake column names.

    Crucially this does NOT blank the interpolation outright. A conditional
    column list -- `${geocode ? 'g.location_address' : 'NULL AS x'}` -- hides
    real column references from every scanner that treats `${...}` as opaque;
    reports.ts referenced a nonexistent gps_breadcrumbs.location_address that
    way. Splicing in BOTH branches can yield SQL that would never execute as
    written, which is fine: we only tokenize identifiers, never run it.
    """
    out, i = [], 0
    while i < len(s):
        if s.startswith('${', i):
            depth, j = 1, i + 2
            while j < len(s) and depth:
                if s[j] == '{':
                    depth += 1
                elif s[j] == '}':
                    depth -= 1
                j += 1
            inner = s[i + 2:j - 1]
            frags = [m.group(1) or m.group(2) or ''
                     for m in re.finditer(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"", inner)]
            keep = [f for f in frags if f.strip() and SQL_FRAGMENT.match(f)]
            out.append(' ' + ' '.join(keep) + ' ' if keep else ' ? ')
            i = j
        else:
            out.append(s[i]); i += 1
    return ''.join(out)


def flatten(sql: str) -> str:
    """Normalise a JS SQL literal: drop comments, blank interpolations/strings."""
    s = strip_interpolations(sql)
    s = re.sub(r'--[^\n]*', ' ', s)               # line comments
    s = re.sub(r'/\*.*?\*/', ' ', s, flags=re.S)  # block comments
    # Escaped \'...\' first: SQL embedded in a JS single-quoted string escapes
    # its own literals, and leaving them intact makes 'in_service' read as a
    # column name.
    s = re.sub(r"\\'(?:[^'\\]|\\.)*?\\'", " '' ", s)
    s = re.sub(r"'(?:[^'\\]|\\.)*'", " '' ", s)   # inner single-quoted literals
    s = re.sub(r'\\"(?:[^"\\]|\\.)*\\"', ' "" ', s)  # escaped double-quoted literals
    return ' '.join(s.split())


def top_level_split(text: str):
    """Split on top-level commas only (parens/function calls stay intact)."""
    out, cur, depth = [], '', 0
    for ch in text:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur); cur = ''
        else:
            cur += ch
    out.append(cur)
    return [x for x in out if x.strip()]


def insert_arity(flat: str):
    """(n_columns, n_values, kind) when an INSERT's counts disagree, else None.

    An arity mismatch is a different defect from a wrong column name, and no
    amount of schema knowledge catches it: dispatch/extensions.ts listed 6
    geofence columns against 7 VALUES (a stray 'info' literal), so that INSERT
    would still have thrown even after migration 0214 supplied the columns.
    """
    im = re.search(r'\bINSERT(?:\s+OR\s+\w+)?\s+INTO\s+[A-Za-z_]\w*\s*\(([^()]*)\)\s*(SELECT\b|VALUES\b)',
                   flat, re.I)
    if not im:
        return None
    n_cols = len(top_level_split(im.group(1)))
    rest = flat[im.end() - 6:]
    if im.group(2).upper().startswith('SELECT'):
        sel = re.search(r'\bSELECT\b(.*?)\bFROM\b', rest, re.I | re.S)
        if not sel:
            return None
        n_vals, kind = len(top_level_split(sel.group(1))), 'SELECT'
    else:
        vm = re.search(r'\bVALUES\s*\((.*?)\)\s*(?:ON\s+CONFLICT|RETURNING|$)', rest, re.I | re.S)
        if not vm:
            return None
        n_vals, kind = len(top_level_split(vm.group(1))), 'VALUES'
    return None if n_cols == n_vals else (n_cols, n_vals, kind)


def main():
    schema = {}
    for r in live_ddl():
        cols = parse_cols(r['sql'])
        if cols:
            schema[r['name']] = cols

    # Tables /src/ creates at runtime (ensure*Schema helpers) are legitimately
    # absent from live until first use, so they are not "missing".
    runtime_created = set()
    for path in SRC.rglob('*.ts'):
        for cm in re.finditer(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)',
                              path.read_text(errors='replace'), re.I):
            runtime_created.add(cm.group(1))

    # ⚠️ The Worker binds THREE D1 databases (wrangler.toml): DB=rmpg-flex,
    # GEO_DB=rmpg-geo, KIOSK_DB=kiosk-linux-fleet. This script only reads
    # rmpg-flex, so a file that queries another binding would have every one of
    # its tables reported "missing" — kiosk_devices is correct code, not a bug.
    # Skip those files entirely rather than emit confident false positives.
    OTHER_DB_BINDINGS = ('KIOSK_DB', 'GEO_DB')

    missing_tables, js_in_sql, arity, findings, files = {}, [], [], [], sorted(SRC.rglob('*.ts'))
    for path in files:
        src = path.read_text(errors='replace')
        if any(b in src for b in OTHER_DB_BINDINGS):
            continue
        for offset, raw in iter_literals(src):
            if not SQL_START.search(raw) or NOT_SQL.search(raw):
                continue
            flat = flatten(raw)
            line = src[:offset].count('\n') + 1

            mismatch = insert_arity(flat)
            if mismatch:
                arity.append((str(path), line, *mismatch))

            bare = re.sub(r'--[^\n]*', ' ', strip_interpolations(raw))
            for jm in JS_IN_SQL.finditer(bare):
                js_in_sql.append((str(path), line, jm.group(0).strip()))

            # Alias map for this statement. Unknown tables (runtime-created,
            # CTEs) map to None so their qualified refs are skipped, not
            # falsely blamed on another table.
            # CTE names declared by this statement are not tables.
            ctes = {c.group(1).lower() for c in
                    re.finditer(r'\b([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*(?:(?:NOT\s+)?MATERIALIZED\s*)?\(',
                                flat, re.I)}

            aliases, tables = {}, []
            for tm in TABLE_REF.finditer(flat):
                tbl, alias = tm.group(1), tm.group(2)
                known = tbl in schema
                # A referenced table that exists NOWHERE is a bigger defect than
                # a bad column, and both scanners used to skip it in silence.
                if (not known and tbl not in runtime_created
                        and tbl.lower() not in ctes and tbl.lower() not in KEYWORDS
                        and tbl != 'sqlite_master' and not tbl.startswith('pragma_')
                        and '_' in tbl):          # single bare words are comment prose
                    missing_tables.setdefault(tbl, []).append(f"{path}:{line}")
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

            # 6. Unqualified refs in a MULTI-TABLE (join) statement. Rules 4
            #    and 5 bail out on joins because an unqualified name could
            #    belong to any participating table -- but that ambiguity only
            #    blocks saying WHICH table owns it. It does not block the
            #    stronger claim: a name that exists on NONE of the joined
            #    tables cannot resolve anywhere, so the statement throws. That
            #    is decidable without knowing the owner, and it is the only
            #    rule that reaches unqualified columns in the joins that make
            #    up most of this codebase's real queries.
            if len(tables) > 1 and all(aliases.values()):
                if len(re.findall(r'\bSELECT\b', flat, re.I)) == 1:
                    known = set().union(*(schema[t] for t in tables))
                    local = {m.group(1).lower() for m in
                             re.finditer(r'\bAS\s+([A-Za-z_][A-Za-z0-9_]*)', flat, re.I)}
                    local |= {m.group(1).lower() for m in
                              re.finditer(r'\)\s*([A-Za-z_][A-Za-z0-9_]*)', flat)}
                    local |= set(aliases)
                    body = re.sub(TABLE_REF, ' ', flat)
                    body = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\s*\(', ' ( ', body)
                    body = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\.\*', ' ', body)
                    body = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*', ' ', body)
                    body = re.sub(r'\bAS\s+[A-Za-z_][A-Za-z0-9_]*', ' ', body, flags=re.I)
                    for col in re.findall(r'[A-Za-z_][A-Za-z0-9_]*', body):
                        if col.lower() in KEYWORDS or col.lower() in local or col in known:
                            continue
                        findings.append((str(path), line,
                                         '|'.join(tables) + ' (join)', col))

            # 5. Unqualified refs in EVERY OTHER clause (WHERE / GROUP BY /
            #    ORDER BY / HAVING) of a single-table, join-free statement.
            #    Made precise by first collecting the names the statement
            #    INVENTS -- explicit `AS x` and implicit `COUNT(*) n` result
            #    aliases -- which SQLite lets you reference downstream
            #    (`GROUP BY month`). Without that step this rule is ~60:1 noise;
            #    with it, it is the only rule that can see a bad column in a
            #    WHERE clause, where a wrong name silently returns zero rows
            #    rather than erroring.
            if len(tables) == 1 and all(aliases.values()) and not re.search(r'\bJOIN\b', flat, re.I):
                if len(re.findall(r'\bSELECT\b', flat, re.I)) == 1:
                    local = {m.group(1).lower() for m in
                             re.finditer(r'\bAS\s+([A-Za-z_][A-Za-z0-9_]*)', flat, re.I)}
                    local |= {m.group(1).lower() for m in
                              re.finditer(r'\)\s*([A-Za-z_][A-Za-z0-9_]*)', flat)}
                    local |= set(aliases)      # the statement's own table aliases
                    tail = re.split(r'\bFROM\b', flat, maxsplit=1, flags=re.I)
                    if len(tail) == 2:
                        body = re.sub(TABLE_REF, ' ', 'FROM ' + tail[1])
                        body = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\s*\(', ' ( ', body)   # fn names
                        body = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\.\*', ' ', body)      # v.*
                        body = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*', ' ', body)
                        body = re.sub(r'\bAS\s+[A-Za-z_][A-Za-z0-9_]*', ' ', body, flags=re.I)
                        for col in re.findall(r'[A-Za-z_][A-Za-z0-9_]*', body):
                            if col.lower() not in local:
                                report(tables[0], col)

            # 4. Unqualified refs in the SELECT LIST of a single-table,
            #    join-free statement -- the one place an unqualified name is
            #    safely attributable. Elsewhere (WHERE, GROUP BY, ORDER BY)
            #    implicit result aliases (`COUNT(*) n`), CTE column names and
            #    SQLite date modifiers are indistinguishable from column refs
            #    without a real parser, and drowned the real hits ~60:1 when
            #    tried -- so those stay out of scope.
            if len(tables) == 1 and all(aliases.values()) and not re.search(r'\bJOIN\b', flat, re.I):
                sel = re.search(r'\bSELECT\b(.*?)\bFROM\b', flat, re.I | re.S)
                if sel and len(re.findall(r'\bSELECT\b', flat, re.I)) == 1:
                    t = re.sub(r'\bAS\s+[A-Za-z_][A-Za-z0-9_]*', ' ', sel.group(1), flags=re.I)
                    t = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\.\*', ' ', t)       # al.*
                    t = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*', ' ', t)
                    prev = None
                    while prev != t:                 # implicit aliases: COUNT(*) n
                        prev = t
                        t = re.sub(r'\)\s*[A-Za-z_][A-Za-z0-9_]*', ')', t)
                    for col in re.findall(r'[A-Za-z_][A-Za-z0-9_]*', t):
                        report(tables[0], col)

    seen, uniq = set(), []
    for f in findings:
        k = (f[0], f[2], f[3])
        if k not in seen:
            seen.add(k); uniq.append(f)

    print(f"live schema: {len(schema)} tables | scanned {len(files)} .ts files")
    print(f"suspect column refs: {len(uniq)}  (verify each before editing)\n")
    for path, line, table, col in sorted(uniq, key=lambda x: (x[0], x[1])):
        print(f"{path}:{line}  {table}.{col}")

    print(f"\nINSERT column/value arity mismatches: {len(arity)}")
    for path, line, ncols, nvals, kind in arity:
        print(f"  {path}:{line}  {ncols} columns vs {nvals} {kind} items")

    print(f"\nSQL literals containing un-interpolated JavaScript: {len(js_in_sql)}")
    for path, line, tok in js_in_sql:
        print(f"  {path}:{line}  [{tok}]  -- D1 receives this as literal text")

    print(f"\nreferenced TABLES absent from live D1: {len(missing_tables)}")
    print("(heuristic: names containing '_'; bare single words are usually "
          "comment prose matched after FROM/UPDATE)")
    for tbl, sites in sorted(missing_tables.items()):
        print(f"  {tbl}  ({len(sites)} site{'s' if len(sites) > 1 else ''})  e.g. {sites[0]}")


if __name__ == '__main__':
    main()
