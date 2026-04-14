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

export type RenderCallback<T = any> = (ctx: RenderContext<T>, data: T) => void;

export type Section<T = any> = SchemaSection<T> | RenderCallback<T>;

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
}
