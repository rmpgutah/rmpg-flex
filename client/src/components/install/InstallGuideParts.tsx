// Shared building blocks for the per-platform installation guides rendered on
// the public /downloads page. Kept deliberately presentational — no data
// fetching, no auth-gated content — so the guides stay readable to a
// not-yet-signed-in officer standing at a new machine.
import React, { useState } from 'react';

/** Section heading inside a guide. */
export function GuideHeading({ children }: { children: React.ReactNode }) {
  return (
    <h5
      className="text-[11px] font-bold uppercase tracking-wider mb-2 mt-5 first:mt-0"
      style={{ color: 'var(--panel-header-color)' }}
    >
      {children}
    </h5>
  );
}

/**
 * A copyable command block. The copy button matters more here than it looks:
 * these guides are read on a phone while typing into a different machine, and
 * the macOS commands contain escaped spaces that are very easy to mistype.
 */
export function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    // navigator.clipboard is unavailable on insecure origins; fall back to a
    // hidden textarea + execCommand so the button never silently does nothing.
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(children).then(done).catch(() => {});
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = children;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } finally {
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="relative my-1.5 group">
      <pre
        className="text-[11px] leading-relaxed pl-3 pr-16 py-2 overflow-x-auto"
        style={{
          background: 'var(--surface-sunken)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
          borderRadius: 2,
          fontFamily: 'Arial, sans-serif',
        }}
      >
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy command to clipboard"
        className="absolute top-1.5 right-1.5 px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-default)',
          color: copied ? 'var(--sev-ok)' : 'var(--text-secondary)',
          borderRadius: 2,
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** A numbered step with a bold title and free-form body. */
export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-3 border-b last:border-b-0" style={{ borderColor: 'var(--surface-raised)' }}>
      <span
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[11px] font-bold"
        style={{ background: 'var(--surface-overlay)', color: 'var(--accent-silver-400)', borderRadius: 2 }}
      >
        {n}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-bold mb-1 text-rmpg-100">{title}</div>
        <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{children}</div>
      </div>
    </div>
  );
}

/** Plain bulleted list used for requirements / notes. */
export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="text-xs leading-relaxed space-y-1" style={{ color: 'var(--text-secondary)' }}>
      {items.map((item, i) => (
        <li key={i}>• {item}</li>
      ))}
    </ul>
  );
}

/**
 * Symptom → cause/fix pairs. Written as "what you actually see on screen"
 * first, because that is what someone searches this page for.
 */
export function Troubleshooting({ items }: { items: { symptom: string; fix: React.ReactNode }[] }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          <div className="font-bold text-rmpg-100">{item.symptom}</div>
          <div>{item.fix}</div>
        </div>
      ))}
    </div>
  );
}

/** Highlighted note/warning box. */
export function Callout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="mt-4 p-3 text-xs leading-relaxed"
      style={{
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border-default)',
        color: 'var(--sev-warn)',
        borderRadius: 2,
      }}
    >
      <strong style={{ color: 'var(--sev-warn-soft)' }}>{label}:</strong> {children}
    </div>
  );
}

/**
 * Screenshot gallery. Click a shot to open it full size in a lightbox —
 * these are 1280x800 captures, unreadable at inline width.
 *
 * Every image here must be a REAL capture of the running system. A mockup on a
 * download page is a promise the product has to keep on first boot.
 */
export function Screenshots({ shots }: { shots: { src: string; caption: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {shots.map((shot) => (
          <figure key={shot.src} className="m-0">
            <button
              type="button"
              onClick={() => setOpen(shot.src)}
              aria-label={`View full size: ${shot.caption}`}
              className="block w-full p-0 cursor-zoom-in"
              style={{ background: 'none', border: '1px solid var(--border-default)', borderRadius: 2 }}
            >
              <img
                src={shot.src}
                alt={shot.caption}
                loading="lazy"
                className="block w-full"
                style={{ borderRadius: 2 }}
              />
            </button>
            <figcaption className="text-[11px] leading-relaxed mt-1.5" style={{ color: 'var(--text-muted)' }}>
              {shot.caption}
            </figcaption>
          </figure>
        ))}
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot full size"
          onClick={() => setOpen(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(null); }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
          className="fixed inset-0 z-50 flex items-center justify-center p-6 cursor-zoom-out"
          style={{ background: 'rgba(0 0 0 / 0.85)' }}
        >
          <img
            src={open}
            alt=""
            className="max-w-full max-h-full"
            style={{ border: '1px solid var(--border-default)', borderRadius: 2 }}
          />
        </div>
      )}
    </>
  );
}

/** Outer frame shared by every platform guide. */
export function GuideFrame({
  title,
  intro,
  children,
}: {
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mt-4 p-5"
      style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
    >
      <h4 className="text-sm font-bold text-rmpg-100 mb-1">{title}</h4>
      <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>{intro}</p>
      {children}
    </div>
  );
}
