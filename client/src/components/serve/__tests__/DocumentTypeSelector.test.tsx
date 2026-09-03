import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentTypeSelector from '../DocumentTypeSelector';
import {
  MATTER_CATEGORIES,
  DOCUMENT_TYPE_OPTIONS,
  getMatterCategoryByDocType,
  getStatementTitle,
} from '../../../constants/documentTypes';

describe('DocumentTypeSelector & documentTypes registry', () => {
  it('has matter categories defined correctly', () => {
    expect(MATTER_CATEGORIES.length).toBeGreaterThanOrEqual(8);
    const categoryIds = MATTER_CATEGORIES.map((c) => c.id);
    expect(categoryIds).toContain('small_claims');
    expect(categoryIds).toContain('divorce_family');
    expect(categoryIds).toContain('eviction_ud');
    expect(categoryIds).toContain('civil_litigation');
    expect(categoryIds).toContain('garnishment_collections');
  });

  it('correctly maps document strings to Matter Categories', () => {
    expect(getMatterCategoryByDocType('Petition for Divorce').id).toBe('divorce_family');
    expect(getMatterCategoryByDocType('Notice to Vacate (3-Day / 30-Day Notice)').id).toBe('eviction_ud');
    expect(getMatterCategoryByDocType('Writ of Garnishment (Earnings / Wages)').id).toBe('garnishment_collections');
    expect(getMatterCategoryByDocType('Summons & Complaint (Small Claims)').id).toBe('small_claims');
    expect(getMatterCategoryByDocType('Petition for Protective Order / Stalking Injunction').id).toBe('protective_orders');
    expect(getMatterCategoryByDocType('Random Document Title').id).toBe('civil_litigation');
  });

  it('resolves formal statement titles', () => {
    expect(getStatementTitle('Summons')).toBe('Summons in a Civil Action');
    expect(getStatementTitle('Petition for Divorce')).toBe('Petition for Divorce / Dissolution of Marriage');
    expect(getStatementTitle('Unknown')).toBe('Unknown');
  });

  it('renders native select variant with optgroups', () => {
    const handleChange = vi.fn();
    render(
      <DocumentTypeSelector
        variant="native"
        value="Summons"
        onChange={handleChange}
        id="test-native-select"
      />
    );

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'Petition for Divorce' } });
    expect(handleChange).toHaveBeenCalledWith('Petition for Divorce');
  });

  it('renders enhanced trigger button and opens popover on click', () => {
    const handleChange = vi.fn();
    render(
      <DocumentTypeSelector
        variant="enhanced"
        value="Summons & Complaint (Civil Action)"
        onChange={handleChange}
      />
    );

    const triggerBtn = screen.getByRole('button');
    expect(triggerBtn).toHaveTextContent('Summons & Complaint (Civil Action)');
    expect(triggerBtn).toHaveTextContent('General Civil');

    // Click to open popover
    fireEvent.click(triggerBtn);

    // Search bar should be rendered
    const searchInput = screen.getByPlaceholderText(/Search document options/i);
    expect(searchInput).toBeInTheDocument();
  });
});
