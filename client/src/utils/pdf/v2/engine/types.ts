export type Width = 'full' | 'half' | 'third' | 'quarter';

export interface FormMeta {
  formNumber: string;
  title: string;
  revision: string;
}

export interface HeaderSpec<T = any> {
  kind: 'default';
  formId: string;
  caseNumberAccessor?: (d: T) => string | undefined;
  /** Label for the caseNumber slot in the header meta row. Defaults to
   *  'CASE'; forms whose "case" value is really something else (e.g. the
   *  PS-211 trip log's report period) override it so the header doesn't
   *  mislabel a date range as a case number. */
  caseLabel?: string;
}

export interface FooterSpec {
  kind: 'default';
  showRevision?: boolean;
  showPageNumbers?: boolean;
}

export interface LabeledField<T = any> {
  kind: 'labeled';
  label: string;
  accessor: (data: T) => unknown;
  width?: Width;
  editable?: boolean;
  readOnlyReason?: string;
  path?: string;
}

export interface CheckboxField<T = any> {
  kind: 'checkbox';
  label: string;
  accessor: (data: T) => boolean | undefined;
  editable?: boolean;
  readOnlyReason?: string;
  path?: string;
}

export interface NarrativeField<T = any> {
  kind: 'narrative';
  label: string;
  accessor: (data: T) => string | undefined;
  minLines?: number;
  editable?: boolean;
  readOnlyReason?: string;
  path?: string;
}

export interface TableColumn {
  key: string;
  header: string;
  width?: Width;
  ratio?: number;
}

export interface TableField<T = any> {
  kind: 'table';
  label: string;
  columns: TableColumn[];
  accessor: (data: T) => Array<Record<string, unknown>>;
  editable?: boolean;
  readOnlyReason?: string;
  path?: string;
}

export interface SignatureField<T = any> {
  kind: 'signature';
  label: string;
  accessor: (data: T) => { image?: string; printedName?: string; date?: string } | undefined;
  editable?: boolean;
  path?: string;
}

export interface SpacerField {
  kind: 'spacer';
  height: number;
}

export type FieldSpec<T = any> =
  | LabeledField<T>
  | CheckboxField<T>
  | NarrativeField<T>
  | TableField<T>
  | SignatureField<T>
  | SpacerField;

export interface SchemaSection<T = any> {
  kind: 'section';
  title: string;
  columns?: 1 | 2 | 3;
  fields: FieldSpec<T>[];
  visibleIf?: (data: T) => boolean;
}

/**
 * Fixed-layout field — every box positioned by absolute (x, y, w, h)
 * in millimeters, relative to the section's origin (layout.leftX,
 * sectionStartY at the time the section begins rendering). The renderer
 * does NOT advance the cursor between fields; it only advances ONCE
 * past the whole section by `FixedLayoutSection.height`. Used for
 * forms that must visually replicate a real-world template (e.g. Utah
 * Uniform Citation, Utah Traffic Crash Report).
 */
export type FixedFieldStyle =
  | 'text'        // accessor's string drawn at (x, y+h-1.5), font-sized; no box drawn
  | 'box'         // accessor's string drawn inside a rectangle border at (x, y, w, h)
  | 'underline'   // accessor's string + a fill-in underline below it (form-fill cue)
  | 'checkbox'    // small square + label; checked when accessor is truthy
  | 'signature'   // accessor.image PNG drawn into the box + underline
  | 'barcode'     // accessor's string drawn as a Code128-like barcode
  | 'line'        // a plain horizontal/vertical rule (no accessor needed)
  | 'rect'        // an outline rectangle (no accessor needed)
  | 'label';      // static label text (uses `label`, not accessor)

export interface FixedField<T = any> {
  /** Schema path for sidecar extraction. Display-only fields omit this. */
  path?: string;
  /** Accessor for the rendered value. Required except for style='line'|'rect'|'label'. */
  accessor?: (data: T) => string | { image?: string } | boolean | undefined | null;
  /** Static label text when style='label' (or as the prefix when style='checkbox'). */
  label?: string;
  /** Absolute mm coordinates relative to the section's origin. */
  x: number;
  y: number;
  w: number;
  h: number;
  style: FixedFieldStyle;
  /** Font size in points (default = TYPOGRAPHY.fieldValue.size = 9pt). */
  fontSize?: number;
  /** Horizontal alignment of text within the box. Default 'left'. */
  align?: 'left' | 'center' | 'right';
  /** When true, render with bold weight. Default false. */
  bold?: boolean;
  /** Visibility predicate — field hidden when this returns false. */
  visibleIf?: (data: T) => boolean;
}

export interface FixedLayoutSection<T = any> {
  kind: 'fixed-layout';
  /** Total height of the section in mm — used to advance the cursor past it. */
  height: number;
  /** All fields drawn at absolute coordinates relative to the section's origin. */
  fields: FixedField<T>[];
  /** Optional show/hide based on data. */
  visibleIf?: (data: T) => boolean;
}

export type RenderCallback<T = any> = (ctx: RenderContext<T>, data: T) => void;

export type Section<T = any> = SchemaSection<T> | FixedLayoutSection<T> | RenderCallback<T>;

export interface FormSchema<T = any> {
  meta: FormMeta;
  header: HeaderSpec<T>;
  sections: Section<T>[];
  footer?: FooterSpec;
  /** Optional watermark label. 'blank-form' renders the "BLANK FORM / FOR FIELD USE" overlay on every page. */
  watermark?: 'blank-form' | 'draft' | string;
}

export interface RenderContext<T = any> {
  readonly cursorY: number;
  readonly pageHeight: number;
  readonly leftX: number;
  readonly rightX: number;
  columnWidth(cols: 1 | 2 | 3, col: 0 | 1 | 2): number;

  section(title: string, fn: (inner: RenderContext<T>) => void): void;
  labeledField(spec: LabeledField<T>, data: T): void;
  checkboxRow(specs: CheckboxField<T>[], data: T): void;
  narrative(spec: NarrativeField<T>, data: T): void;
  table(spec: TableField<T>, data: T): void;
  signature(spec: SignatureField<T>, data: T): void;
  spacer(height: number): void;

  pageBreakIfNeeded(heightNeeded: number): void;

  /** Direct access to the underlying Primitives instance — used by
   *  callback sections that delegate to a render helper which prefers
   *  the primitives API over the wrapped context methods. */
  readonly primitives: import('./primitives').Primitives;
  /** Direct access to the underlying LayoutEngine. */
  readonly layout: import('./layout').LayoutEngine;
  /** Direct access to the underlying jsPDF doc — used by callback sections
   *  that call standalone primitive functions (drawBadge, drawSeverityMeter,
   *  drawCrossRefChip, drawPhotoGrid) which take (doc, layout, opts). */
  readonly doc: import('jspdf').default;
}
