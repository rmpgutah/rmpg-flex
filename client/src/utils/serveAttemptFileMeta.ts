export const SERVE_FILE_KINDS = ['document', 'photo', 'audio'] as const;
export type ServeFileKind = (typeof SERVE_FILE_KINDS)[number];

export const SERVE_DOCUMENT_TYPES = [
  'summons',
  'complaint',
  'subpoena',
  'affidavit',
  'notice',
  'posted_notice',
  'door_photo',
  'recipient_id',
  'vehicle_photo',
  'property_photo',
  'voice_memo',
  'conversation_recording',
  'other',
] as const;

export type ServeDocumentType = (typeof SERVE_DOCUMENT_TYPES)[number];

export const SERVE_DOCUMENT_TYPE_LABELS: Record<ServeDocumentType, string> = {
  summons: 'Summons',
  complaint: 'Complaint',
  subpoena: 'Subpoena',
  affidavit: 'Affidavit',
  notice: 'Notice',
  posted_notice: 'Posted notice',
  door_photo: 'Door / location photo',
  recipient_id: 'Recipient identification',
  vehicle_photo: 'Vehicle photo',
  property_photo: 'Property photo',
  voice_memo: 'Voice memo',
  conversation_recording: 'Conversation recording',
  other: 'Other',
};

export function inferServeFileKind(mime: string | null | undefined, filename?: string | null): ServeFileKind {
  const m = (mime || '').toLowerCase();
  const name = (filename || '').toLowerCase();
  if (m.startsWith('image/')) return 'photo';
  if (m.startsWith('audio/') || name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg')) return 'audio';
  return 'document';
}

export const SERVE_ATTEMPT_FILE_ACCEPT =
  'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.mp3,.wav,.ogg,audio/mpeg,audio/mp3';
