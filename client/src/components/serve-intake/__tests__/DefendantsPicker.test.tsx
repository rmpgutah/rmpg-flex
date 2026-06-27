import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DefendantsPicker from '../DefendantsPicker';
import type { DetectedDefendant } from '../../../utils/serveIntakeDefendants';

const dd = (name: string): DetectedDefendant => ({
  name, raw_source: name, split_confidence: 1.0, is_business: false,
});

describe('<DefendantsPicker>', () => {
  it('renders nothing when 0 defendants', () => {
    const { container } = render(
      <DefendantsPicker detected={[]} selected={[]} onChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when exactly 1 defendant', () => {
    const { container } = render(
      <DefendantsPicker detected={[dd('John Smith')]} selected={['John Smith']} onChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a checkbox per defendant when N >= 2', () => {
    render(
      <DefendantsPicker
        detected={[dd('John Smith'), dd('Jane Doe')]}
        selected={['John Smith', 'Jane Doe']}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText('John Smith')).toBeChecked();
    expect(screen.getByLabelText('Jane Doe')).toBeChecked();
  });

  it('emits onChange with the toggled name when a box is clicked', () => {
    const seen: string[][] = [];
    render(
      <DefendantsPicker
        detected={[dd('John Smith'), dd('Jane Doe')]}
        selected={['John Smith', 'Jane Doe']}
        onChange={s => seen.push(s)}
      />,
    );
    fireEvent.click(screen.getByLabelText('Jane Doe'));
    expect(seen[seen.length - 1]).toEqual(['John Smith']);
  });
});
