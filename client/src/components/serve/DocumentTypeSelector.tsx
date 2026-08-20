import React, { useState, useMemo } from 'react';
import {
  MATTER_CATEGORIES,
  DOCUMENT_TYPE_OPTIONS,
  getMatterCategoryByDocType,
  DocumentTypeOption,
} from '../../constants/documentTypes';
import { Search, Check, ChevronDown, Sparkles, Scale, Users, Home, FileText, Coins, ShieldAlert, BookOpen, AlertTriangle, File, Plus } from 'lucide-react';

const ICON_MAP: Record<string, React.ElementType> = {
  Scale,
  Users,
  Home,
  FileText,
  Coins,
  ShieldAlert,
  BookOpen,
  AlertTriangle,
  File,
};

interface DocumentTypeSelectorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  variant?: 'native' | 'enhanced';
  showCategoryBadges?: boolean;
}

export default function DocumentTypeSelector({
  id = 'document-type-selector',
  value,
  onChange,
  className = '',
  variant = 'enhanced',
}: DocumentTypeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [customValue, setCustomValue] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  // Match current value with options or identify as custom
  const currentCategory = useMemo(() => getMatterCategoryByDocType(value), [value]);

  // Filter options based on category tab and search query
  const filteredOptions = useMemo(() => {
    return DOCUMENT_TYPE_OPTIONS.filter((opt) => {
      // Category filter
      if (selectedCategory !== 'all' && opt.matterCategoryId !== selectedCategory) {
        return false;
      }
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesLabel = opt.label.toLowerCase().includes(q);
        const matchesStatement = opt.statementTitle.toLowerCase().includes(q);
        const matchesValue = opt.value.toLowerCase().includes(q);
        const matchesAlias = opt.aliases?.some((a) => a.toLowerCase().includes(q));
        return matchesLabel || matchesStatement || matchesValue || matchesAlias;
      }
      return true;
    });
  }, [selectedCategory, searchQuery]);

  // Group filtered options by Matter Category
  const groupedOptions = useMemo(() => {
    const map = new Map<string, DocumentTypeOption[]>();
    filteredOptions.forEach((opt) => {
      const list = map.get(opt.matterCategoryId) || [];
      list.push(opt);
      map.set(opt.matterCategoryId, list);
    });
    return map;
  }, [filteredOptions]);

  // Common quick-picks for fast selection
  const quickPicks = useMemo(() => [
    'Summons & Complaint (Civil Action)',
    'Petition for Divorce',
    'Notice to Vacate (3-Day / 30-Day Notice)',
    'Summons & Complaint for Eviction',
    'Writ of Restitution (Eviction Lockout)',
    'Writ of Garnishment (Earnings / Wages)',
    'Summons & Complaint (Small Claims)',
    'Subpoena',
  ], []);

  // Handle native select change
  if (variant === 'native') {
    return (
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors ${className}`}
      >
        {MATTER_CATEGORIES.map((cat) => {
          const catOptions = DOCUMENT_TYPE_OPTIONS.filter((o) => o.matterCategoryId === cat.id);
          if (catOptions.length === 0) return null;
          return (
            <optgroup key={cat.id} label={`── ${cat.label.toUpperCase()} ──`} className="bg-surface-raised text-rmpg-300 font-semibold">
              {catOptions.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-surface-deep text-rmpg-100 py-1">
                  {opt.isCombined ? `[Bundle] ${opt.label}` : opt.label}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    );
  }

  // Enhanced Dropdown & Popover Mode
  return (
    <div className="relative w-full">
      {/* Trigger Button */}
      <button
        type="button"
        id={id}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 hover:border-rmpg-500 rounded-[2px] text-rmpg-100 transition-all focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 ${className}`}
      >
        <div className="flex items-center gap-2 min-w-0 overflow-hidden text-left">
          <span className={`inline-flex items-center text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-[2px] border ${currentCategory.badgeBg} ${currentCategory.badgeText} ${currentCategory.badgeBorder} shrink-0`}>
            {currentCategory.shortLabel}
          </span>
          <span className="truncate text-xs font-medium text-rmpg-100">{value || 'Select Document Type...'}</span>
        </div>
        <ChevronDown size={14} className={`text-rmpg-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-raised border border-rmpg-700 rounded-[2px] shadow-2xl overflow-hidden max-h-[460px] flex flex-col animate-in fade-in-50 duration-150">
          {/* Header & Search */}
          <div className="p-2.5 bg-surface-deep border-b border-rmpg-700 space-y-2">
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-2.5 text-rmpg-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search document options (e.g. Petition, Summons, Eviction)..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-raised border border-rmpg-700 rounded-[2px] text-rmpg-100 placeholder-rmpg-500 focus:border-rmpg-400 focus:outline-none"
                autoFocus
              />
            </div>

            {/* Matter Category Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded-[2px] transition-colors whitespace-nowrap ${
                  selectedCategory === 'all'
                    ? 'bg-rmpg-500 text-rmpg-100'
                    : 'bg-surface-raised text-rmpg-400 hover:text-rmpg-200 hover:bg-surface-sunken'
                }`}
              >
                All Matters
              </button>
              {MATTER_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded-[2px] transition-colors whitespace-nowrap border ${
                    selectedCategory === cat.id
                      ? `${cat.badgeBg} ${cat.badgeText} ${cat.badgeBorder} ring-1 ring-rmpg-400/40`
                      : 'bg-surface-raised text-rmpg-400 border-transparent hover:border-rmpg-700'
                  }`}
                >
                  {cat.shortLabel}
                </button>
              ))}
            </div>
          </div>

          {/* Quick-Pick Section (Shown when no search query) */}
          {!searchQuery && selectedCategory === 'all' && (
            <div className="px-2.5 py-2 bg-surface-sunken/40 border-b border-rmpg-800">
              <div className="text-[9px] uppercase font-semibold text-brand-gold-500 tracking-wider mb-1.5 flex items-center gap-1">
                <Sparkles size={10} /> Popular Document Statement Bundles
              </div>
              <div className="flex flex-wrap gap-1">
                {quickPicks.map((qp) => (
                  <button
                    key={qp}
                    type="button"
                    onClick={() => {
                      onChange(qp);
                      setIsOpen(false);
                    }}
                    className={`text-[10px] px-2 py-1 rounded-[2px] border transition-all text-left ${
                      value === qp
                        ? 'bg-rmpg-500/20 text-rmpg-200 border-rmpg-500/50 font-semibold'
                        : 'bg-surface-deep/80 text-rmpg-300 border-rmpg-700/60 hover:bg-surface-raised hover:border-rmpg-500'
                    }`}
                  >
                    {qp}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Document List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-3 scrollbar-dark">
            {groupedOptions.size === 0 ? (
              <div className="py-6 text-center text-xs text-rmpg-400">
                No matching legal documents found for &quot;{searchQuery}&quot;.
              </div>
            ) : (
              MATTER_CATEGORIES.map((cat) => {
                const options = groupedOptions.get(cat.id);
                if (!options || options.length === 0) return null;
                const CatIcon = ICON_MAP[cat.iconName] || FileText;

                return (
                  <div key={cat.id} className="space-y-1">
                    {/* Category Header */}
                    <div className="flex items-center gap-1.5 px-1 py-1 border-b border-rmpg-800 text-[10px] font-bold uppercase tracking-wider text-rmpg-400">
                      <CatIcon size={12} className={cat.badgeText} />
                      <span className={cat.badgeText}>{cat.label}</span>
                      <span className="text-rmpg-500 font-mono font-normal">({options.length})</span>
                    </div>

                    {/* Category Items */}
                    <div className="grid grid-cols-1 gap-0.5 pt-0.5">
                      {options.map((opt) => {
                        const isSelected = value === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              onChange(opt.value);
                              setIsOpen(false);
                            }}
                            className={`w-full flex items-start justify-between p-2 rounded-[2px] text-left transition-all group ${
                              isSelected
                                ? 'bg-rmpg-500/20 text-rmpg-100 border border-rmpg-500/40'
                                : 'hover:bg-surface-deep text-rmpg-300 hover:text-rmpg-100 border border-transparent'
                            }`}
                          >
                            <div className="space-y-0.5 min-w-0 pr-2">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-semibold ${isSelected ? 'text-rmpg-300' : 'group-hover:text-rmpg-200'}`}>
                                  {opt.label}
                                </span>
                                {opt.isCombined && (
                                  <span className="text-[9px] uppercase tracking-wider font-bold px-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-[2px]">
                                    Bundle
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-rmpg-400 truncate">
                                Statement Title: <span className="text-rmpg-300 font-mono">{opt.statementTitle}</span>
                              </div>
                            </div>
                            {isSelected && <Check size={14} className="text-rmpg-400 shrink-0 mt-1" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer / Custom Text Input Toggle */}
          <div className="p-2 bg-surface-deep border-t border-rmpg-700">
            {!isCustomMode ? (
              <button
                type="button"
                onClick={() => setIsCustomMode(true)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-brand-gold-400 hover:text-brand-gold-300 hover:bg-surface-raised rounded-[2px] transition-colors font-medium"
              >
                <Plus size={12} /> Type Custom Document Title...
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  placeholder="Enter custom document title..."
                  className="flex-1 px-2 py-1 text-xs bg-surface-raised border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    if (customValue.trim()) {
                      onChange(customValue.trim());
                      setIsOpen(false);
                      setIsCustomMode(false);
                    }
                  }}
                  className="px-2.5 py-1 text-xs bg-rmpg-500 text-rmpg-100 font-semibold rounded-[2px] hover:bg-rmpg-400 transition-colors"
                >
                  Use
                </button>
                <button
                  type="button"
                  onClick={() => setIsCustomMode(false)}
                  className="px-2 py-1 text-xs text-rmpg-400 hover:text-rmpg-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
