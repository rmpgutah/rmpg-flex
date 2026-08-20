export interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Converts a page-coordinate point (e.g. from a pointer event) into the
 * image's OWN natural pixel space, accounting for the image's on-page
 * position/size (displayRect, typically from getBoundingClientRect())
 * and its natural (unscaled) dimensions (naturalWidth/naturalHeight).
 * Used so box annotations drawn on a scaled/responsive <img> are stored
 * in coordinates meaningful against the original document image.
 */
export function imageToNaturalCoords(
  displayRect: DisplayRect,
  naturalWidth: number,
  naturalHeight: number,
  point: Point,
): Point {
  const localX = point.x - displayRect.left;
  const localY = point.y - displayRect.top;
  const scaleX = naturalWidth / displayRect.width;
  const scaleY = naturalHeight / displayRect.height;
  const x = Math.round(Math.min(Math.max(localX * scaleX, 0), naturalWidth));
  const y = Math.round(Math.min(Math.max(localY * scaleY, 0), naturalHeight));
  return { x, y };
}
