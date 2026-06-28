// Standard 14 PDF font name → web font family mapping.
//
// The Standard 14 fonts (Helvetica, Times, Courier, Symbol, ZapfDingbats and
// their bold/italic variants) are required to be available in every PDF
// reader without being embedded. We map them to the closest CSS family the
// browser ships. This is a Type 1 / Type 3 approximation — exact metrics
// will differ slightly. Unsupported fonts trigger backend fallback.

const STANDARD_14: Record<string, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  'Helvetica-Bold': 'bold Helvetica, Arial, sans-serif',
  'Helvetica-Oblique': 'italic Helvetica, Arial, sans-serif',
  'Helvetica-BoldOblique': 'bold italic Helvetica, Arial, sans-serif',
  'Times-Roman': 'Times, "Times New Roman", serif',
  'Times-Bold': 'bold Times, "Times New Roman", serif',
  'Times-Italic': 'italic Times, "Times New Roman", serif',
  'Times-BoldItalic': 'bold italic Times, "Times New Roman", serif',
  Courier: 'Courier, "Courier New", monospace',
  'Courier-Bold': 'bold Courier, "Courier New", monospace',
  'Courier-Oblique': 'italic Courier, "Courier New", monospace',
  'Courier-BoldOblique': 'bold italic Courier, "Courier New", monospace',
  Symbol: 'Symbol, serif',
  ZapfDingbats: 'ZapfDingbats, sans-serif',
};

export function stdFontFamily(baseFontName: string | undefined | null): string | null {
  if (!baseFontName) return null;
  // Strip subset prefix (e.g. "ABCDEF+Helvetica" → "Helvetica") that some
  // generators add even for Standard 14.
  const cleaned = baseFontName.replace(/^[A-Z]{6}\+/, '');
  return STANDARD_14[cleaned] ?? null;
}
