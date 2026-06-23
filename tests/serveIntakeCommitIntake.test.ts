import { describe, it, expect } from 'vitest';

// commitIntake currently lives in src/utils/serveIntakeRecords.ts. The
// in-memory D1 stub here covers only the SQL touch-points the multi-defendant
// loop exercises. Tests assume the existing single-defendant happy path is
// already covered elsewhere (regression guard).

import { commitIntake } from '../src/utils/serveIntakeRecords';

function makeDbStub() {
  const rows: Record<string, any[]> = {
    persons: [], properties: [], calls_for_service: [], serve_queue: [],
    case_files: [], case_persons: [],
  };
  let lastId = 1000;
  const prepare = (sql: string) => {
    const stmt = {
      bind: (..._args: any[]) => stmt,
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => {
        lastId++;
        const table = (sql.match(/INSERT INTO (\w+)/i) || [])[1];
        if (table) rows[table] = rows[table] || [];
        if (table) rows[table].push({ id: lastId });
        return { meta: { last_row_id: lastId, changes: 1 } };
      },
    };
    return stmt;
  };
  return { prepare, _rows: rows };
}

describe('commitIntake with defendantsSelected', () => {
  it('creates 1 intake when defendantsSelected has 1 entry', async () => {
    const db: any = makeDbStub();
    await commitIntake(db, {
      fields: { recipient_first_name: { value: 'John', confidence: 0.9 },
                recipient_last_name: { value: 'Smith', confidence: 0.9 } },
      queueRow: { recipient_name: 'John Smith', recipient_address: '1 Main St' } as any,
      userId: 1, documentSummary: '', docCount: 1,
      defendantsSelected: ['John Smith'],
      judgeRunId: 17,
      env: {} as any,
    });
    expect(db._rows.serve_queue.length).toBe(1);
  });

  it('creates N intakes when defendantsSelected has N entries', async () => {
    const db: any = makeDbStub();
    await commitIntake(db, {
      fields: { recipient_first_name: { value: 'John', confidence: 0.9 },
                recipient_last_name: { value: 'Smith', confidence: 0.9 } },
      queueRow: { recipient_name: 'John Smith', recipient_address: '1 Main St' } as any,
      userId: 1, documentSummary: '', docCount: 1,
      defendantsSelected: ['John Smith', 'Jane Smith', 'Bob Doe'],
      judgeRunId: 17,
      env: {} as any,
    });
    expect(db._rows.serve_queue.length).toBe(3);
  });

  it('honours null defendantsSelected as single-recipient legacy path', async () => {
    const db: any = makeDbStub();
    await commitIntake(db, {
      fields: { recipient_first_name: { value: 'John', confidence: 0.9 },
                recipient_last_name: { value: 'Smith', confidence: 0.9 } },
      queueRow: { recipient_name: 'John Smith', recipient_address: '1 Main St' } as any,
      userId: 1, documentSummary: '', docCount: 1,
      env: {} as any,
    });
    expect(db._rows.serve_queue.length).toBe(1);
  });
});
