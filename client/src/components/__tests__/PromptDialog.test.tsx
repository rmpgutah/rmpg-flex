import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromptDialog from '../PromptDialog';

describe('PromptDialog', () => {
  it('submits trimmed text and closes via Confirm', async () => {
    const user = userEvent.setup();
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
    await user.clear(input);
    await user.type(input, '  Patrol  ');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledWith('Patrol');
  });

  it('disables Confirm when empty unless allowEmpty', async () => {
    const user = userEvent.setup();
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
    await user.type(screen.getByLabelText('URL'), 'https://example.com');
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled();
  });

  it('allows a blank submit when allowEmpty is set', async () => {
    const user = userEvent.setup();
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
    await user.clear(screen.getByLabelText('Goal'));
    await user.click(screen.getByRole('button', { name: 'Set' }));
    expect(onSubmit).toHaveBeenCalledWith('');
  });
});
