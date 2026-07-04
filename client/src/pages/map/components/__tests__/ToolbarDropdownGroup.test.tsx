import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Layers } from 'lucide-react';
import ToolbarDropdownGroup from '../ToolbarDropdownGroup';

describe('ToolbarDropdownGroup', () => {
  it('renders the trigger button and hides children until opened', () => {
    render(
      <ToolbarDropdownGroup icon={Layers} label="Overlays" open={false} onToggle={vi.fn()}>
        <div data-testid="child-toggle">child</div>
      </ToolbarDropdownGroup>
    );
    expect(screen.getByLabelText('Overlays')).toBeInTheDocument();
    expect(screen.queryByTestId('child-toggle')).not.toBeInTheDocument();
  });

  it('shows children when open is true', () => {
    render(
      <ToolbarDropdownGroup icon={Layers} label="Overlays" open={true} onToggle={vi.fn()}>
        <div data-testid="child-toggle">child</div>
      </ToolbarDropdownGroup>
    );
    expect(screen.getByTestId('child-toggle')).toBeInTheDocument();
  });

  it('calls onToggle when the trigger button is clicked', () => {
    const onToggle = vi.fn();
    render(
      <ToolbarDropdownGroup icon={Layers} label="Overlays" open={false} onToggle={onToggle}>
        <div>child</div>
      </ToolbarDropdownGroup>
    );
    fireEvent.click(screen.getByLabelText('Overlays'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
