import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommitDropdown } from '../CommitDropdown';

describe('CommitDropdown', () => {
  it('shows the primary action label on the main button', () => {
    render(<CommitDropdown allowedActions={['download', 'print']} onSelect={() => {}} />);
    expect(screen.getByText(/Commit: Download/i)).toBeInTheDocument();
  });

  it('fires onSelect with the primary action when main button is clicked', async () => {
    const onSelect = vi.fn();
    render(<CommitDropdown allowedActions={['download', 'print']} onSelect={onSelect} />);
    await userEvent.click(screen.getByText(/Commit: Download/i));
    expect(onSelect).toHaveBeenCalledWith('download');
  });

  it('opens the menu and fires onSelect for secondary actions', async () => {
    const onSelect = vi.fn();
    render(<CommitDropdown allowedActions={['download', 'print']} onSelect={onSelect} />);
    await userEvent.click(screen.getByLabelText('More commit options'));
    await userEvent.click(screen.getByText('Print'));
    expect(onSelect).toHaveBeenCalledWith('print');
  });
});
