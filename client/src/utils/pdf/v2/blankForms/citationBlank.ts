// ============================================================
// citationBlank — printable blank Utah Uniform Citation
// ============================================================
// The blank an officer prints for field use is the SAME document
// the court receives, just unpopulated: same box grid, same label
// wording, same statutory notices. It is therefore derived from
// citationUtahMasterSchema rather than maintained as a parallel
// list of labels — the old hand-kept mirror drifted from the
// populated form every time one of them changed, and a blank that
// doesn't match the filed copy is a blank an officer can't use.
//
// The only differences are the BLANK FORM watermark and the form
// number suffix.

import type { FormSchema } from '../engine/types';
import { citationUtahMasterSchema, type CitationUtahData } from '../forms/citationUtahMaster';

export type CitationBlankData = Record<string, never>;

export const citationBlankSchema: FormSchema<CitationBlankData> = {
  ...(citationUtahMasterSchema as unknown as FormSchema<CitationBlankData>),
  meta: {
    ...citationUtahMasterSchema.meta,
    formNumber: `${citationUtahMasterSchema.meta.formNumber}-BLK`,
  },
  header: { ...citationUtahMasterSchema.header, formId: 'citation_blank' },
  watermark: 'blank-form',
};

// Re-exported so a caller that needs the populated shape (e.g. to fill a
// blank in-place) doesn't have to reach across into forms/.
export type { CitationUtahData };
