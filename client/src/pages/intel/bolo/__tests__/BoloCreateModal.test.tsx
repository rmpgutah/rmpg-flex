import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BoloCreateModal from '../BoloCreateModal';

describe('BoloCreateModal', () => {
  it('submits the entered fields', () => {
    const onCreate = vi.fn();
    render(<BoloCreateModal onClose={() => {}} onCreate={onCreate} />);
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: 'Stolen plate' } });
    fireEvent.click(screen.getByText(/create bolo/i));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stolen plate', type: 'person', priority: 'P3' }));
  });

  it('does not submit without a title', () => {
    const onCreate = vi.fn();
    render(<BoloCreateModal onClose={() => {}} onCreate={onCreate} />);
    fireEvent.click(screen.getByText(/create bolo/i));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
