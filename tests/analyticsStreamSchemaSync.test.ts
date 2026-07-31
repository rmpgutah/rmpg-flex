// tests/analyticsStreamSchemaSync.test.ts
// ============================================================
// Keeps the Cloudflare Pipelines STREAM SCHEMAS in sync with the event
// emitters that feed them.
// ------------------------------------------------------------
// The two streams provisioned for the analytics lakehouse
// (rmpg_alpr_reads, rmpg_flex_events) are STRUCTURED streams: Cloudflare
// validates every event against the declared schema and REJECTS anything
// carrying an undeclared field. Combined with emitAnalytics()'s
// fire-and-forget `.catch(log)` design, a drifted schema loses rows silently —
// the Worker keeps serving, nothing 500s, and the Iceberg table just quietly
// stops gaining data.
//
// So: adding a field to alprReadEvent()/flexEvent() without adding it to the
// matching scripts/analytics/*.schema.json is a silent data-loss bug. This test
// makes that a red build instead.
//
// Asserting EQUALITY (not merely subset) is deliberate in both directions:
//   - emitted ⊄ schema  ⇒ Cloudflare rejects the event (data loss)
//   - schema ⊄ emitted  ⇒ a column that can never be populated, which shows up
//     later as a mysteriously all-NULL field in the warehouse
//
// Schemas verified against the live emitters on 2026-07-31: 22/22 ALPR fields
// and 15/15 flex fields, and every column referenced by the eight build*Sql
// helpers exists in one of the two schemas.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { alprReadEvent, flexEvent } from '../src/utils/analytics';

function schemaFields(file: string): string[] {
  const raw = readFileSync(join(process.cwd(), 'scripts', 'analytics', file), 'utf-8');
  const parsed = JSON.parse(raw) as { fields: Array<{ name: string; type: string; required?: boolean }> };
  return parsed.fields.map((f) => f.name).sort();
}

describe('analytics stream schemas stay in sync with the emitters', () => {
  it('alpr-reads.schema.json matches every key alprReadEvent produces', () => {
    // Fully-populated input so no key is omitted by a conditional.
    const event = alprReadEvent(
      {
        captureRowId: 1, callId: 2, incidentId: 3,
        lat: 40.76, lng: -111.89, locationText: '300 S Main St',
        // `source` is a union of 'edge' | 'field', not free text.
        userId: 7, source: 'field',
      },
      {
        plate: '7XER187', raw_plate: '7XERI87', state: 'UT',
        make: 'Dodge', model: 'Charger', color: 'Black',
        vehicle_type: 'Sedan', year: 2015, trust_score: 0.93,
        vehicle_record_id: 11, hits: [],
      } as unknown as Record<string, unknown>,
      '2026-07-31T00:00:00.000Z',
    );
    expect(Object.keys(event).sort()).toEqual(schemaFields('alpr-reads.schema.json'));
  });

  it('flex-events.schema.json matches every key flexEvent produces', () => {
    const event = flexEvent({
      event_type: 'cfs_created',
      occurred_at: '2026-07-31T00:00:00.000Z',
      actor_id: 7, source: 'dispatch',
      entity_type: 'call', entity_id: 42, unit_id: 'A-12',
      lat: 40.76, lng: -111.89,
      status: 'dispatched', label: 'Alarm', category: 'cad',
      priority: 'P2', value: 1,
      payload: { note: 'x' },
    });
    expect(Object.keys(event).sort()).toEqual(schemaFields('flex-events.schema.json'));
  });

  it('declares event_type and occurred_at as the only REQUIRED fields', () => {
    // Every other field is optional by design: emitters null out anything the
    // source did not supply, and a `required` field arriving null is rejected.
    for (const file of ['alpr-reads.schema.json', 'flex-events.schema.json']) {
      const raw = readFileSync(join(process.cwd(), 'scripts', 'analytics', file), 'utf-8');
      const parsed = JSON.parse(raw) as { fields: Array<{ name: string; required?: boolean }> };
      const required = parsed.fields.filter((f) => f.required).map((f) => f.name).sort();
      expect(required).toEqual(['event_type', 'occurred_at']);
    }
  });

  it('uses only Cloudflare Pipelines-supported column types', () => {
    // Guards against a plausible-looking but invalid type (e.g. "integer",
    // "boolean", "text") that would only fail at stream-creation time.
    const supported = new Set(['string', 'int32', 'int64', 'float32', 'float64', 'bool', 'timestamp', 'json', 'binary', 'list', 'struct']);
    for (const file of ['alpr-reads.schema.json', 'flex-events.schema.json']) {
      const raw = readFileSync(join(process.cwd(), 'scripts', 'analytics', file), 'utf-8');
      const parsed = JSON.parse(raw) as { fields: Array<{ name: string; type: string }> };
      for (const f of parsed.fields) {
        expect(supported.has(f.type), `${file}: field "${f.name}" has unsupported type "${f.type}"`).toBe(true);
      }
    }
  });
});
