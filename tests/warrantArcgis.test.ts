import { describe, it, expect } from 'vitest';
import { parseArcgis } from '../src/utils/warrantSources/parse/arcgis';
import type { FieldMap } from '../src/utils/warrantSources/parse/socrata';

const ARLINGTON = { features: [ { attributes: {
  OBJECTID: 1, FirstName: 'JOHN', MiddleName: 'Q', LastName: 'SMITH',
  OffenseDescription: 'UNSAFE SPEED', CitationNumber: 'CIT-99', AmountDue: 557.83,
  WarrantType: 'CAPIAS', WarrantIssuanceDate: 482112000000, City: 'ARLINGTON', State: 'TX',
} } ] };
const MAP: FieldMap = { first: 'FirstName', middle: 'MiddleName', last: 'LastName', charge: 'OffenseDescription', case_no: 'CitationNumber', bond: 'AmountDue', issued: 'WarrantIssuanceDate', warrant_type: 'WarrantType', city: 'City', state: 'State' };

describe('parseArcgis', () => {
  it('maps features[].attributes to RawWarrantHit, converting epoch-ms dates', () => {
    const hits = parseArcgis(ARLINGTON, MAP, 'arcgis-arlington-tx');
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.full_name).toBe('Smith, John Q');
    expect(h.charge_description).toBe('UNSAFE SPEED');
    expect(h.case_number).toBe('CIT-99');
    expect(h.bail_amount).toBe(557.83);
    expect(h.issue_date).toBe('1985-04-12'); // epoch-ms → ISO (482112000000 = 1985-04-12 UTC)
    expect(h.warrant_type).toBe('CAPIAS');
  });
  it('returns [] for a missing/empty features array', () => {
    expect(parseArcgis({}, MAP, 'x')).toEqual([]);
    expect(parseArcgis({ features: [] }, MAP, 'x')).toEqual([]);
  });
});
