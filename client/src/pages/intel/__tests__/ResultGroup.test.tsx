import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import ResultGroup, { groupByType } from '../search/ResultGroup';

vi.mock('../../../hooks/useApi', () => ({ authedImageUrl: (u: string) => u }));

const mk = (type: string, id: number) => ({ hit: { type, id, label: `${type}-${id}`, snippet: '', flags: [], score: 50 }, linkedCount: 1, siblings: [] }) as any;

describe('groupByType', () => {
  it('groups and orders by group size desc', () => {
    const groups = groupByType([mk('person', 1), mk('vehicle', 2), mk('person', 3)]);
    expect(groups.map(([t, items]) => [t, items.length])).toEqual([['person', 2], ['vehicle', 1]]);
  });
});

describe('ResultGroup', () => {
  it('renders the type label header with a count', () => {
    render(<ResultGroup type="person" items={[mk('person', 1)]} onSelect={() => {}} onOpen={() => {}} />);
    expect(screen.getByText('PERSONS')).toBeInTheDocument();
    expect(screen.getByText(/· 1/)).toBeInTheDocument();
  });
});
