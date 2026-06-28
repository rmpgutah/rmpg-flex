import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, cleanup } from '@testing-library/react';
import SpillmanGroupBox from '../SpillmanGroupBox';

afterEach(cleanup);

describe('SpillmanGroupBox', () => {
  it('renders the title and children', () => {
    render(
      <SpillmanGroupBox title="Name and Address">
        <label>Last</label>
      </SpillmanGroupBox>,
    );
    expect(screen.getByText('Name and Address')).toBeInTheDocument();
    expect(screen.getByText('Last')).toBeInTheDocument();
  });

  it('exposes the section anchor and column count', () => {
    const { container } = render(
      <SpillmanGroupBox title="Traits" anchor="spm-sec-traits" columns={3}>
        <span />
      </SpillmanGroupBox>,
    );
    expect(container.querySelector('[data-section-anchor="spm-sec-traits"]')).not.toBeNull();
    const body = container.querySelector('.spm-groupbox-body') as HTMLElement;
    expect(body.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  });
});
