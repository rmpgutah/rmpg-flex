// ============================================================
// RMPG Flex — OCR text cleanup
// ============================================================
// Pre-processing for OCR output from ocrmypdf/Tesseract.
// Fixes common artifacts without heavy NLP. Idempotent on
// born-digital text (all transforms are no-ops on clean input).
// ============================================================

/**
 * Clean up common OCR artifacts in extracted PDF text.
 */
export function cleanOcrText(text: string): string {
  let result = text;

  // 1. Strip null bytes and control characters (keep \n, \r, \t)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 2. Rejoin hyphenated line-breaks: "assess-\nment" → "assessment"
  //    Only when a lowercase letter follows the hyphen+newline
  result = result.replace(/-\n([a-z])/g, '$1');

  // 3. Normalize Unicode substitutions
  //    fi/fl ligatures
  result = result.replace(/\uFB01/g, 'fi');
  result = result.replace(/\uFB02/g, 'fl');
  //    Em-dash variants (U+2014, U+2013, U+2012) → standard hyphen-minus
  result = result.replace(/[\u2012\u2013\u2014]/g, '-');
  //    Smart quotes → straight quotes
  result = result.replace(/[\u2018\u2019\u201A]/g, "'");
  result = result.replace(/[\u201C\u201D\u201E]/g, '"');

  // 4. Fix common OCR number/letter substitutions in address context
  //    Only at word boundary (start of line or after whitespace)
  //    followed by lowercase to avoid false positives on real data
  result = result.replace(/(^|[\s])0([a-z])/gm, (_m, pre, rest) => {
    // 0ak → Oak, 0live → Olive, etc.
    return pre + 'O' + rest;
  });
  result = result.replace(/(^|[\s])1([a-z])/gm, (_m, pre, rest) => {
    // 1ake → Lake, 1incoln → Lincoln, etc.
    return pre + 'L' + rest;
  });

  // 5. Collapse runs of 3+ spaces into 2 (preserve pdftotext column alignment)
  result = result.replace(/ {3,}/g, '  ');

  return result;
}
