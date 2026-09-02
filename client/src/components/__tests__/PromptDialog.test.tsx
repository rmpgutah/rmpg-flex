import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PromptDialog from '../PromptDialog';

describe('PromptDialog', () => {
  it('submits trimmed text and closes via Confirm', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(
      <PromptDialog
        isOpen
        onClose={onClose}
        onSubmit={onSubmit}
        title="Group name"
        message="Name this desktop group."
        label="Name"
        defaultValue="New Group"
        confirmLabel="Create"
      />,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveValue('New Group');
    fireEvent.change(input, { target: { value: '  Patrol  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledWith('Patrol');
  });

  it('disables Confirm when empty unless allowEmpty', () => {
    const onSubmit = vi.fn();
    render(
      <PromptDialog
        isOpen
        onClose={() => {}}
        onSubmit={onSubmit}
        title="Link"
        message="Enter a URL."
        label="URL"
        defaultValue=""
      />,
    );
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } });
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled();
  });

  it('allows a blank submit when allowEmpty is set', () => {
    const onSubmit = vi.fn();
    render(
      <PromptDialog
        isOpen
        onClose={() => {}}
        onSubmit={onSubmit}
        title="Word goal"
        message="Blank or 0 clears the goal."
        label="Goal"
        defaultValue="500"
        allowEmpty
        confirmLabel="Set"
      />,
    );
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));
    expect(onSubmit).toHaveBeenCalledWith('');
  });
});
