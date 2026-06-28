import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SpillmanWindow from '../SpillmanWindow';

afterEach(cleanup);

describe('SpillmanWindow', () => {
  it('renders title, screen name and children', () => {
    render(
      <SpillmanWindow title="Brown, James" screenName="Names Table">
        <p>body</p>
      </SpillmanWindow>,
    );
    expect(screen.getByText('Brown, James')).toBeInTheDocument();
    expect(screen.getByText('Names Table')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders a status bar only when status content is provided', () => {
    const { rerender } = render(<SpillmanWindow title="t"><span /></SpillmanWindow>);
    expect(document.querySelector('.spm-window-status')).toBeNull();
    rerender(
      <SpillmanWindow title="t" statusLeft="User: czamora" statusRight="OVR Rec">
        <span />
      </SpillmanWindow>,
    );
    expect(screen.getByText('User: czamora')).toBeInTheDocument();
    expect(screen.getByText('OVR Rec')).toBeInTheDocument();
  });

  it('calls onClose when the close control is clicked', () => {
    const onClose = vi.fn();
    render(<SpillmanWindow title="t" onClose={onClose}><span /></SpillmanWindow>);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
