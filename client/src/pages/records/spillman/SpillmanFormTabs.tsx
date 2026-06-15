import React, { useLayoutEffect, useRef, useState } from 'react';
import type { FormSection } from './recordFormSections';

interface Props { sections: FormSection[]; }

export default function SpillmanFormTabs({ sections }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Many detail-panel sections render conditionally on the record's data
  // (Mechanical, Stolen / Tow, Damage, …). Show only the tabs whose anchor
  // actually rendered so we never offer a tab that scrolls nowhere. Runs in a
  // layout effect — siblings of this strip are committed before it fires, so
  // pruning happens before paint (no flash of the full list).
  const [visible, setVisible] = useState<FormSection[]>(sections);
  const [active, setActive] = useState<string | null>(sections[0]?.target ?? null);

  useLayoutEffect(() => {
    const scope: ParentNode = ref.current?.parentElement ?? document;
    const present = sections.filter(
      (s) => scope.querySelector(`[data-section-anchor="${s.target}"]`),
    );
    // Fall back to the full list if nothing matched (e.g. detail not yet in DOM)
    // rather than hiding the strip entirely.
    const next = present.length > 0 ? present : sections;
    setVisible(next);
    setActive((cur) => (cur && next.some((s) => s.target === cur) ? cur : next[0]?.target ?? null));
  }, [sections]);

  if (sections.length === 0) return null;

  const go = (target: string) => {
    setActive(target);
    // Scope the lookup to the detail panel (this strip's parent subtree) so
    // duplicate section slugs elsewhere on the page can't be matched.
    const scope: ParentNode = ref.current?.parentElement ?? document;
    const el = scope.querySelector(`[data-section-anchor="${target}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div ref={ref} className="spm-form-tabs" role="tablist" aria-label="Record form sections">
      {visible.map((s) => (
        <button
          key={s.target}
          type="button"
          role="tab"
          aria-selected={active === s.target}
          className={`spm-form-tab ${active === s.target ? 'on' : ''}`}
          onClick={() => go(s.target)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
