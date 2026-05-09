// Text truncation and utilities

/** Truncate text with ellipsis */
export function truncate(text: string, maxLength: number, suffix = '…'): string {
  if (!text || text.length <= maxLength) return text || '';
  return text.slice(0, maxLength - suffix.length).trimEnd() + suffix;
}

/** Truncate text at word boundary */
export function truncateWords(
  text: string,
  maxLength: number,
  suffix = '…'
): string {
  if (!text || text.length <= maxLength) return text || '';
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.5) {
    return truncated.slice(0, lastSpace).trimEnd() + suffix;
  }
  return truncated.trimEnd() + suffix;
}

/** Highlight search term in text (returns HTML string) */
export function highlightText(text: string, searchTerm: string): string {
  if (!searchTerm || !text) return text || '';
  const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return text.replace(
    regex,
    '<mark class="bg-yellow-300/30 text-inherit">$1</mark>'
  );
}

/** Convert text to title case */
export function toTitleCase(text: string): string {
  if (!text) return '';
  return text.replace(
    /\w\S*/g,
    (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
  );
}

/** Pluralize a word based on count */
export function pluralize(
  count: number,
  singular: string,
  plural?: string
): string {
  return count === 1 ? singular : plural || `${singular}s`;
}

/** Generate initials from a name */
export function initials(name: string, maxChars = 2): string {
  if (!name) return '';
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, maxChars)
    .join('');
}
