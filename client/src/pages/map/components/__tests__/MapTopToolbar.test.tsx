import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapTopToolbar from '../MapTopToolbar';

const baseProps = {
  scaleEnabled: false, onToggleScale: vi.fn(),
  fullscreenEnabled: false, onToggleFullscreen: vi.fn(),
  minimapOpen: false, onToggleMinimap: vi.fn(),
  mapStyle: 'dark' as const, onStyleChange: vi.fn(),
  showBookmarksPanel: false, onToggleBookmarks: vi.fn(),
  legendOpen: false, onToggleLegend: vi.fn(),
  onSnapshot: vi.fn(),
  onExportImage: vi.fn(),
  onCopyImage: vi.fn(),
};

describe('MapTopToolbar', () => {
  it('renders scale, fullscreen, minimap, bookmarks, and snapshot controls', () => {
    render(<MapTopToolbar {...baseProps} />);
    expect(screen.getByLabelText(/scale bar/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fullscreen/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/minimap/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bookmarks/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/capture snapshot/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/copy map image/i)).toBeInTheDocument();
  });

  it('calls onToggleScale when the scale button is clicked', () => {
    render(<MapTopToolbar {...baseProps} />);
    fireEvent.click(screen.getByLabelText(/scale bar/i));
    expect(baseProps.onToggleScale).toHaveBeenCalledTimes(1);
  });

  it('calls onSnapshot when the snapshot button is clicked', () => {
    render(<MapTopToolbar {...baseProps} />);
    fireEvent.click(screen.getByLabelText(/capture snapshot/i));
    expect(baseProps.onSnapshot).toHaveBeenCalledTimes(1);
  });
});
