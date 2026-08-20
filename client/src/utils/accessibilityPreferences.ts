export function getTextScale(): number {
  return parseInt(localStorage.getItem('rmpg_text_scale') ?? '100', 10);
}

export function setTextScale(n: number): void {
  localStorage.setItem('rmpg_text_scale', String(n));
  document.documentElement.style.fontSize = (n / 100) * 16 + 'px';
}

export function isKeyboardNavEnabled(): boolean {
  return localStorage.getItem('rmpg_keyboard_nav') === '1';
}

export function setKeyboardNavEnabled(on: boolean): void {
  localStorage.setItem('rmpg_keyboard_nav', on ? '1' : '0');
  document.documentElement.classList.toggle('keyboard-nav', on);
}

export function isReducedMotion(): boolean {
  return localStorage.getItem('rmpg_reduced_motion') === '1';
}

export function setReducedMotion(on: boolean): void {
  localStorage.setItem('rmpg_reduced_motion', on ? '1' : '0');
  document.documentElement.classList.toggle('reduced-motion', on);
}

export function getCursorSize(): number {
  return parseInt(localStorage.getItem('rmpg_cursor_size') ?? '16', 10);
}

export function setCursorSize(n: number): void {
  localStorage.setItem('rmpg_cursor_size', String(n));
  applyCursorStyle();
}

export function getCursorColor(): string {
  return localStorage.getItem('rmpg_cursor_color') ?? 'silver';
}

export function setCursorColor(c: string): void {
  localStorage.setItem('rmpg_cursor_color', c);
  applyCursorStyle();
}

function makeCursorSvg(size: number, colorName: string): string {
  const colors: Record<string, string> = {
    silver: '#c3ccd6',
    white: '#ffffff',
    yellow: '#fde047',
    red: '#ef4444',
  };
  const fill = colors[colorName] ?? colors['silver'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16"><path d="M 0 0 L 0 12 L 3.5 9 L 6 14 L 7.5 13 L 5 8 L 9 8 Z" fill="${fill}" stroke="black" stroke-width="0.5"/></svg>`;
}

export function applyCursorStyle(): void {
  const size = getCursorSize();
  const color = getCursorColor();
  if (size === 16 && color === 'silver') {
    document.documentElement.style.cursor = '';
    return;
  }
  const svg = makeCursorSvg(size, color);
  document.documentElement.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 0, auto`;
}
