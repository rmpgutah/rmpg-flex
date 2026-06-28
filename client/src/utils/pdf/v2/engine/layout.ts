import type jsPDF from 'jspdf';

export interface LayoutMargins {
  topMargin: number;
  bottomMargin: number;
  leftMargin: number;
  rightMargin: number;
}

export class LayoutEngine {
  private _cursorY: number;
  private _pageNumber: number;

  constructor(private readonly doc: jsPDF, private readonly margins: LayoutMargins) {
    this._cursorY = margins.topMargin;
    this._pageNumber = 1;
  }

  get cursorY(): number { return this._cursorY; }
  get pageNumber(): number { return this._pageNumber; }
  get leftX(): number { return this.margins.leftMargin; }
  get rightX(): number { return this.doc.internal.pageSize.getWidth() - this.margins.rightMargin; }
  get pageHeight(): number { return this.doc.internal.pageSize.getHeight(); }
  get contentHeight(): number { return this.pageHeight - this.margins.topMargin - this.margins.bottomMargin; }

  advance(dy: number): void {
    this._cursorY += dy;
  }

  setCursor(y: number): void {
    this._cursorY = y;
  }

  /**
   * Start a new page if `heightNeeded` won't fit before the bottom margin.
   * Returns `true` when a page break happened, `false` otherwise.
   *
   * `onBeforeBreak` (when supplied) runs AFTER overflow is detected but BEFORE
   * `doc.addPage()` — i.e. while jsPDF's current page and the cursor are still
   * those of the page being closed. Per-page drawing that must land on the page
   * it belongs to (e.g. a long table's fragment borders) MUST use this hook,
   * because anything drawn after `addPage()` paints onto the new page instead.
   */
  pageBreakIfNeeded(heightNeeded: number, onBeforeBreak?: () => void): boolean {
    const bottomLimit = this.pageHeight - this.margins.bottomMargin;
    if (this._cursorY + heightNeeded > bottomLimit) {
      onBeforeBreak?.();
      this.doc.addPage();
      this._pageNumber += 1;
      this._cursorY = this.margins.topMargin;
      return true;
    }
    return false;
  }
}
