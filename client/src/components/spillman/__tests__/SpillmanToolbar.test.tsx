import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SpillmanToolbar, { type ToolbarButton } from '../SpillmanToolbar';

afterEach(cleanup);

describe('SpillmanToolbar', () => {
  it('renders a button per entry with accessible labels', () => {
    const buttons: ToolbarButton[] = [
      { id: 'srch', label: 'Srch' },
      { id: 'add', label: 'Add' },
    ];
    render(<SpillmanToolbar ariaLabel="Records actions" buttons={buttons} />);
    expect(screen.getByRole('toolbar', { name: 'Records actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Srch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('fires onClick and respects disabled', () => {
    const onClick = vi.fn();
    const onDisabled = vi.fn();
    const buttons: ToolbarButton[] = [
      { id: 'a', label: 'Go', onClick },
      { id: 'b', label: 'Nope', onClick: onDisabled, disabled: true },
    ];
    render(<SpillmanToolbar ariaLabel="t" buttons={buttons} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nope' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onDisabled).not.toHaveBeenCalled();
  });

  it('renders the leading slot', () => {
    render(
      <SpillmanToolbar ariaLabel="t" leading={<span>AV</span>} buttons={[{ id: 'x', label: 'X' }]} />,
    );
    expect(screen.getByText('AV')).toBeInTheDocument();
  });
});
