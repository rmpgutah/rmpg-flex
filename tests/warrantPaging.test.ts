import { describe, it, expect } from 'vitest';
import {
  buildArcgisKeysetUrl, buildSocrataOffsetUrl, maxObjectId, arcgisHasMore,
  ARCGIS_SERVER_PAGE, CHUNK_TARGET,
} from '../src/utils/warrantSources/paging';

describe('paging helpers', () => {
  it('builds an arcgis keyset URL ordered by OBJECTID after the cursor', () => {
    const url = buildArcgisKeysetUrl('https://h/svc/MapServer/9', 4200, 2000);
    expect(url).toContain('/query?');
    expect(url).toContain('where=OBJECTID%3E4200');        // OBJECTID>4200, encoded
    expect(url).toContain('orderByFields=OBJECTID%20ASC');
    expect(url).toContain('resultRecordCount=2000');
    expect(url).toContain('outFields=*');
    expect(url).toContain('f=json');
  });

  it('starts an arcgis scan from OBJECTID>0 when cursor is 0', () => {
    expect(buildArcgisKeysetUrl('https://h/9', 0, 2000)).toContain('where=OBJECTID%3E0');
  });

  it('builds a socrata offset URL with a stable :id order', () => {
    const url = buildSocrataOffsetUrl('data.x.gov', 'ab12-cd34', 10000, 5000);
    expect(url).toBe('https://data.x.gov/resource/ab12-cd34.json?$limit=5000&$offset=10000&$order=:id');
  });

  it('maxObjectId returns the largest OBJECTID, falling back when empty', () => {
    const feats = [{ attributes: { OBJECTID: 7 } }, { attributes: { OBJECTID: 19 } }, { attributes: { OBJECTID: 11 } }];
    expect(maxObjectId(feats, 0)).toBe(19);
    expect(maxObjectId([], 42)).toBe(42);
  });

  it('arcgisHasMore is true on a full page or exceededTransferLimit, false on a short final page', () => {
    expect(arcgisHasMore({ features: new Array(2000).fill({}), exceededTransferLimit: true }, 2000)).toBe(true);
    expect(arcgisHasMore({ features: new Array(2000).fill({}) }, 2000)).toBe(true);  // full page → assume more
    expect(arcgisHasMore({ features: new Array(37).fill({}) }, 2000)).toBe(false);   // short page → done
    expect(arcgisHasMore({ features: [] }, 2000)).toBe(false);
  });

  it('exposes the page-size constants', () => {
    expect(ARCGIS_SERVER_PAGE).toBe(2000);
    expect(CHUNK_TARGET).toBe(5000);
  });
});
