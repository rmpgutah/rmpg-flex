import React from 'react';

export interface SpillmanGroupBoxProps {
  title: string;
  anchor?: string;
  columns?: number;
  children: React.ReactNode;
}

/** Titled Spillman group box. `anchor` exposes a data-section-anchor hook
 *  (used by the Records form-tab strip in P2); `columns` sets the field grid. */
export default function SpillmanGroupBox({
  title, anchor, columns = 2, children,
}: SpillmanGroupBoxProps) {
  return (
    <fieldset className="spm-groupbox" data-section-anchor={anchor}>
      <legend className="spm-groupbox-head">{title}</legend>
      <div
        className="spm-groupbox-body"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {children}
      </div>
    </fieldset>
  );
}
