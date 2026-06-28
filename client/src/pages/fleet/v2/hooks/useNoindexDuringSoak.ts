import { useEffect } from 'react';

/** Single constant flipped at cutover (PR 7'c) to remove the noindex meta. */
export const V2_SOAK_ACTIVE = true;

const META_NAME = 'robots';
const META_CONTENT = 'noindex';

let refCount = 0;
let metaEl: HTMLMetaElement | null = null;

function add() {
  if (!metaEl) {
    metaEl = document.createElement('meta');
    metaEl.setAttribute('name', META_NAME);
    metaEl.setAttribute('content', META_CONTENT);
    document.head.appendChild(metaEl);
  }
  refCount += 1;
}

function remove() {
  refCount -= 1;
  if (refCount <= 0 && metaEl) {
    metaEl.remove();
    metaEl = null;
    refCount = 0;
  }
}

/** Adds <meta name="robots" content="noindex"> while soak is on.
 *  Reference-counts so multiple Route components mounting the hook
 *  don't duplicate or prematurely remove the tag. */
export function useNoindexDuringSoak(): void {
  useEffect(() => {
    if (!V2_SOAK_ACTIVE) return;
    add();
    return remove;
  }, []);
}
