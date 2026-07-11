import React from 'react';

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
  role?: string;
  'aria-label'?: string;
}

export default function GlassPanel({
  children,
  className = '',
  as: Tag = 'div',
  ...rest
}: GlassPanelProps & Record<string, unknown>) {
  return (
    <Tag className={`glass-panel ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
