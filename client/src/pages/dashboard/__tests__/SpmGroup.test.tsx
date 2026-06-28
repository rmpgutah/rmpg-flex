import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpmGroup from '../SpmGroup';

describe('SpmGroup', () => {
  it('renders the title and children', () => {
    render(<SpmGroup title="Active Calls"><div>body-content</div></SpmGroup>);
    expect(screen.getByText('Active Calls')).toBeTruthy();
    expect(screen.getByText('body-content')).toBeTruthy();
  });
  it('applies the tone class to the header', () => {
    const { container } = render(<SpmGroup title="BOLOs" tone="red"><span>x</span></SpmGroup>);
    expect(container.querySelector('.spm-group-head.tone-red')).toBeTruthy();
  });
  it('defaults to steel tone', () => {
    const { container } = render(<SpmGroup title="X"><span>x</span></SpmGroup>);
    expect(container.querySelector('.spm-group-head.tone-steel')).toBeTruthy();
  });
});
