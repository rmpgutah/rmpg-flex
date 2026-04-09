// ═══════════════════════════════════════════════════════════════
// Feature 21: Breadcrumb Navigation for admin pages
// ═══════════════════════════════════════════════════════════════
import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export default function Breadcrumbs({ items, className = '' }: BreadcrumbsProps) {
  return (
    <nav className={`flex items-center gap-1 text-[10px] ${className}`} aria-label="Breadcrumb">
      <Link
        to="/"
        className="text-rmpg-500 hover:text-brand-400 transition-colors"
        title="Home"
      >
        <Home className="w-3 h-3" />
      </Link>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          <ChevronRight className="w-2.5 h-2.5 text-rmpg-600 flex-shrink-0" />
          {item.path && i < items.length - 1 ? (
            <Link
              to={item.path}
              className="text-rmpg-400 hover:text-brand-400 transition-colors uppercase font-bold tracking-wider"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-rmpg-200 uppercase font-bold tracking-wider">
              {item.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
