import React, { useRef, useState } from 'react';
import type { FormSection } from './recordFormSections';

interface Props { sections: FormSection[]; }

export default function SpillmanFormTabs({ sections }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(sections[0]?.target ?? null);

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
      {sections.map((s) => (
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
