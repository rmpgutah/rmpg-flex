/** Slugify a section title into a stable anchor id for Spillman form-tab scroll.
 *  "Physical Description" -> "spm-sec-physical-description" */
export function sectionAnchorId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `spm-sec-${slug}`;
}
