#!/usr/bin/env -S node --no-experimental-strip-types-warning
// Runnable end-to-end demo of the warrants-utah-gov adapter against the
// LIVE state API. Zero deps — uses Node 22+'s built-in TS strip-types
// and global fetch.
//
// Usage:
//   node shared/warrants-poller/cli/lookup.ts <FIRST> <LAST> [--age N] [--dob YYYY-MM-DD] [--json]
//
// Examples:
//   node shared/warrants-poller/cli/lookup.ts JOHN SMITH
//   node shared/warrants-poller/cli/lookup.ts JOHNNY SMITH --age 47
//   node shared/warrants-poller/cli/lookup.ts JANE DOE --dob 1990-03-14 --json
//
// Output: warrant table (default) or raw JSON (--json).
// Exit codes: 0 ok, 1 no warrants found, 2 invalid args, 3 source error.

import { WarrantsUtahGovSource } from '../sources/warrants-utah-gov.ts';
import type { WarrantRecord } from '../types.ts';

interface Args {
  first: string;
  last: string;
  age?: number;
  dob?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args | { error: string } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--age' || a === '--dob') flags[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) return { error: `unknown flag: ${a}` };
    else positional.push(a);
  }
  if (positional.length !== 2) {
    return { error: 'expected exactly 2 positional args: <FIRST> <LAST>' };
  }
  return {
    first: positional[0],
    last: positional[1],
    age: flags.age != null ? Number(flags.age) : undefined,
    dob: typeof flags.dob === 'string' ? flags.dob : undefined,
    json: !!flags.json,
  };
}

function printTable(records: WarrantRecord[]): void {
  if (records.length === 0) {
    process.stderr.write('(no active warrants)\n');
    return;
  }
  const rows = records.map((r) => ({
    Subject: r.subjectName,
    Charge: r.charges[0] ?? '',
    Court: r.issuingCourt ?? '',
    Case: r.notes?.replace(/^Case /, '') ?? '',
    Issued: r.issuedDate ?? '',
    City: r.lastKnownAddress ?? '',
  }));
  console.table(rows);
  if (records.some((r) => r.charges.length > 1)) {
    process.stderr.write('(note: some persons have multiple charges; showing first only in table)\n');
  }
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    process.stderr.write(`error: ${parsed.error}\n\n`);
    process.stderr.write('usage: lookup.ts <FIRST> <LAST> [--age N] [--dob YYYY-MM-DD] [--json]\n');
    return 2;
  }

  const source = new WarrantsUtahGovSource({ minIntervalMs: 250 });
  const query = {
    name: `${parsed.first} ${parsed.last}`,
    age: parsed.age,
    dob: parsed.dob,
  };

  process.stderr.write(`> looking up "${query.name}"`);
  if (query.age !== undefined) process.stderr.write(` age=${query.age}`);
  if (query.dob) process.stderr.write(` dob=${query.dob}`);
  process.stderr.write('\n');

  let records: WarrantRecord[];
  try {
    records = await source.lookup(query);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`source error: ${msg}\n`);
    return 3;
  }

  if (parsed.json) {
    process.stdout.write(JSON.stringify(records, null, 2) + '\n');
  } else {
    printTable(records);
  }
  return records.length > 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
