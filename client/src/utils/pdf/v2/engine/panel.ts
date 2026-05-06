// client/src/utils/pdf/v2/engine/panel.ts
import type jsPDF from 'jspdf';
import { LayoutEngine } from './layout';

export interface PanelBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Panel constrains a LayoutEngine to a sub-region of a page. Used by
 * renderMultiCopyPdfV2 to render the citation schema into the left
 * 4.25"-wide half and the copy-specific instructions into the right
 * half without either overflowing into the other.
 */
export class Panel {
  constructor(public readonly bounds: PanelBounds, private readonly doc: jsPDF) {}

  layout(): LayoutEngine {
    const pageHeight = this.doc.internal.pageSize.getHeight();
    const pageWidth = this.doc.internal.pageSize.getWidth();
    return new LayoutEngine(this.doc, {
      topMargin: this.bounds.top,
      bottomMargin: pageHeight - (this.bounds.top + this.bounds.height),
      leftMargin: this.bounds.left,
      rightMargin: pageWidth - (this.bounds.left + this.bounds.width),
    });
  }
}
