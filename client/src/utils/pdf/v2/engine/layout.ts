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

  pageBreakIfNeeded(heightNeeded: number): void {
    const bottomLimit = this.pageHeight - this.margins.bottomMargin;
    if (this._cursorY + heightNeeded > bottomLimit) {
      this.doc.addPage();
      this._pageNumber += 1;
      this._cursorY = this.margins.topMargin;
    }
  }
}
