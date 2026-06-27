import { describe, it, expect } from 'vitest';
import { upsertView, removeView, type SavedView } from './caseSavedViews';

const v = (name: string, filters = {}): SavedView => ({ name, filters });

describe('caseSavedViews', () => {
  it('upsert adds a new view, sorted by name', () => {
    const r = upsertView([v('Zeta'), v('Alpha')], v('Mid'));
    expect(r.map((x) => x.name)).toEqual(['Alpha', 'Mid', 'Zeta']);
  });

  it('upsert replaces an existing view by case-insensitive name', () => {
    const r = upsertView([v('Open', { status: 'open' })], v('open', { overdue: true }));
    expect(r).toHaveLength(1);
    expect(r[0].filters).toEqual({ overdue: true });
  });

  it('upsert trims the stored name', () => {
    expect(upsertView([], v('  Mine  ', { mine: true }))[0].name).toBe('Mine');
  });

  it('removeView deletes case-insensitively and leaves the rest', () => {
    const r = removeView([v('A'), v('B')], 'a');
    expect(r.map((x) => x.name)).toEqual(['B']);
  });

  it('removeView is a no-op for an unknown name', () => {
    expect(removeView([v('A')], 'zzz')).toHaveLength(1);
  });
});
