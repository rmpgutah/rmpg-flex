// Pure geometry for the custom always-visible tab-strip scrollbar.
// Kept free of DOM access so it is unit-testable (jsdom can't lay out
// elements — scrollWidth/clientWidth are always 0 — so the math lives here
// and the DOM module in tabScrollbars.ts feeds it real measurements).

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export interface ThumbInput {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  trackWidth: number;
  minThumb: number;
}

export interface ThumbMetrics {
  visible: boolean;
  thumbWidth: number;
  thumbLeft: number;
}

/** Given a strip's scroll state + the track width, size & place the thumb. */
export function computeThumb({
  scrollLeft,
  scrollWidth,
  clientWidth,
  trackWidth,
  minThumb,
}: ThumbInput): ThumbMetrics {
  // No overflow → nothing to show.
  if (scrollWidth <= clientWidth) {
    return { visible: false, thumbWidth: 0, thumbLeft: 0 };
  }
  const ratio = clientWidth / scrollWidth;
  const thumbWidth = Math.min(trackWidth, Math.max(minThumb, Math.round(trackWidth * ratio)));
  const maxScrollLeft = scrollWidth - clientWidth;
  const maxThumbLeft = trackWidth - thumbWidth;
  const thumbLeft =
    maxScrollLeft <= 0 || maxThumbLeft <= 0
      ? 0
      : clamp(Math.round((scrollLeft / maxScrollLeft) * maxThumbLeft), 0, maxThumbLeft);
  return { visible: true, thumbWidth, thumbLeft };
}

export interface ThumbToScrollInput {
  thumbLeft: number;
  trackWidth: number;
  thumbWidth: number;
  scrollWidth: number;
  clientWidth: number;
}

/** Inverse of computeThumb: a thumb position (e.g. mid-drag) → scrollLeft. */
export function scrollLeftFromThumb({
  thumbLeft,
  trackWidth,
  thumbWidth,
  scrollWidth,
  clientWidth,
}: ThumbToScrollInput): number {
  const maxThumbLeft = trackWidth - thumbWidth;
  const maxScrollLeft = scrollWidth - clientWidth;
  if (maxThumbLeft <= 0 || maxScrollLeft <= 0) return 0;
  return clamp(Math.round((thumbLeft / maxThumbLeft) * maxScrollLeft), 0, maxScrollLeft);
}

export interface TrackClickInput {
  clickX: number;
  trackWidth: number;
  scrollWidth: number;
  clientWidth: number;
}

/** Clicking the track jumps the viewport so its center lands on the click. */
export function scrollLeftFromTrackClick({
  clickX,
  trackWidth,
  scrollWidth,
  clientWidth,
}: TrackClickInput): number {
  const maxScrollLeft = scrollWidth - clientWidth;
  if (maxScrollLeft <= 0 || trackWidth <= 0) return 0;
  const target = Math.round((clickX / trackWidth) * scrollWidth - clientWidth / 2);
  return clamp(target, 0, maxScrollLeft);
}
