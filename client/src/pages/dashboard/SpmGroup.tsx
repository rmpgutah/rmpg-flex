import React from 'react';

export type SpmTone = 'steel' | 'red' | 'gold';

interface SpmGroupProps {
  title: string;
  tone?: SpmTone;
  className?: string;
  children: React.ReactNode;
}

/**
 * Spillman Flex "group box": a titled panel with a gradient header bar.
 * Colors come from the .dashboard-page skin layer in spillman.css (day/night aware),
 * so this component only emits structural classes.
 */
export default function SpmGroup({ title, tone = 'steel', className = '', children }: SpmGroupProps) {
  return (
    <section className={`spm-group ${className}`.trim()}>
      <div className={`spm-group-head tone-${tone}`}>{title}</div>
      <div className="spm-group-body">{children}</div>
    </section>
  );
}
