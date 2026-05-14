// Clipboard copy utility

/** Copy text to clipboard with fallback */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    // Fallback for non-secure contexts
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}

/** Copy text and return a status message */
export async function copyWithFeedback(
  text: string,
  label = 'Text'
): Promise<string> {
  const success = await copyToClipboard(text);
  return success
    ? `${label} copied to clipboard`
    : `Failed to copy ${label.toLowerCase()}`;
}
