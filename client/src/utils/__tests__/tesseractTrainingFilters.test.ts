import { describe, test, expect } from 'vitest';
import {
  parseTrainingSearchParams,
  trainingFiltersToSearchParams,
  trainingListQueryString,
} from '../tesseractTrainingFilters';

describe('tesseract training list filters', () => {
  test('round-trips query string state', () => {
    const sp = new URLSearchParams('page=2&doc_type=complaint&labeled=false&from=2026-08-01&to=2026-08-15&id=44');
    const parsed = parseTrainingSearchParams(sp);
    expect(parsed).toEqual({
      page: 2,
      docType: 'complaint',
      labeled: 'false',
      from: '2026-08-01',
      to: '2026-08-15',
      selected: '44',
    });
    expect(trainingFiltersToSearchParams(parsed).toString()).toBe(sp.toString());
  });

  test('omits default page 1 from the URL', () => {
    const params = trainingFiltersToSearchParams({
      page: 1, docType: '', labeled: '', from: '', to: '', selected: '',
    });
    expect(params.toString()).toBe('');
  });

  test('builds the documents list query with page always present', () => {
    expect(trainingListQueryString({
      page: 1, docType: 'null', labeled: 'true', from: '', to: '',
    })).toBe('page=1&doc_type=null&labeled=true');
  });
});
