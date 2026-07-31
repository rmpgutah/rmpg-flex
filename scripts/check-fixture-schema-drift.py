#!/usr/bin/env python3
"""Find test fixtures that declare columns live D1 does not have.

    python3 scripts/check-fixture-schema-drift.py [dir ...]     # default: test-workers tests

WHY THIS EXISTS
---------------
Miniflare tests build their own tables with CREATE TABLE. When a fixture
declares a column that live D1 lacks, the fixture becomes a second, competing
source of schema truth — and it is the one CI believes. The route SQL under
test passes locally and in CI, then throws "no such column" against production
forever. Because these call sites almost all try/catch into [] or {}, nothing
crashes and nothing reaches error_log; the feature just renders empty.

That is not hypothetical: test-workers/fromDlScanLinking.test.ts declared
warrants.warrant_type / offense_description / bond_amount, which kept a broken
records.ts SELECT green for as long as it existed (live has type /
charge_description / bail_amount). A fixture asserting the wrong schema is
strictly worse than no test, so this check exists to keep fixtures honest.

Only tables that EXIST on live D1 are compared — fixtures may freely invent
scratch tables that production does not have.

Exit code is 0 always; this is a report, not a gate. Companion to
check-schema-refs-deep.py, which checks the other direction (route SQL naming
columns no table has).
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util

_spec = importlib.util.spec_from_file_location(
    'schema_refs_deep', Path(__file__).resolve().parent / 'check-schema-refs-deep.py')
_deep = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_deep)

CREATE_TABLE = re.compile(
    r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(', re.I)


def main():
    dirs = sys.argv[1:] or ['test-workers', 'tests']
    schema = {r['name']: _deep.parse_cols(r['sql']) for r in _deep.live_ddl()}
    schema = {k: v for k, v in schema.items() if v}

    hits, scanned = [], 0
    for d in dirs:
        for path in sorted(Path(d).rglob('*.ts')):
            scanned += 1
            src = path.read_text(errors='replace')
            for cm in CREATE_TABLE.finditer(src):
                table = cm.group(1)
                if table not in schema:
                    continue          # fixture-only scratch table — fine
                declared = _deep.parse_cols(src[cm.start():])
                extra = sorted(c for c in declared if c not in schema[table])
                if extra:
                    hits.append((str(path), src[:cm.start()].count('\n') + 1, table, extra))

    print(f"live schema: {len(schema)} tables | scanned {scanned} .ts files in {', '.join(dirs)}")
    print(f"fixtures declaring columns live D1 lacks: {len(hits)}\n")
    for path, line, table, extra in hits:
        print(f"{path}:{line}  {table}  ->  {', '.join(extra)}")


if __name__ == '__main__':
    main()
