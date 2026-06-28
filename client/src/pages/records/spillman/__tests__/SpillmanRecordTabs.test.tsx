import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import SpillmanRecordTabs, { type SpillmanRecordTab } from '../SpillmanRecordTabs';

const tabs: SpillmanRecordTab[] = [
  { id: 'persons', label: 'Names', count: 52 },
  { id: 'vehicles', label: 'Vehicles', count: 44 },
];

describe('SpillmanRecordTabs', () => {
  it('marks the active tab selected and shows its count', () => {
    render(<SpillmanRecordTabs tabs={tabs} activeTab="persons" onSelect={() => {}} />);
    const active = screen.getByRole('tab', { selected: true });
    expect(active).toHaveTextContent('Names');
    expect(active).toHaveTextContent('(52)');
  });

  it('fires onSelect with the clicked tab id', () => {
    const onSelect = vi.fn();
    render(<SpillmanRecordTabs tabs={tabs} activeTab="persons" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: /Vehicles/ }));
    expect(onSelect).toHaveBeenCalledWith('vehicles');
  });
});
