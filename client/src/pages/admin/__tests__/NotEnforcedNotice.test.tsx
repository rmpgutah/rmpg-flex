import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import NotEnforcedNotice from '../NotEnforcedNotice';

describe('NotEnforcedNotice', () => {
  it('states plainly that the value is stored but not yet applied', () => {
    render(<NotEnforcedNotice what="Priority labels and colors" />);
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.getByText(/Priority labels and colors/)).toBeInTheDocument();
    expect(screen.getByText(/not yet enforced/i)).toBeInTheDocument();
  });
});
