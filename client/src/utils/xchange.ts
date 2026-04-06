// ============================================================
// RMPG Flex — Utah Courts XChange Helper
// Shared utility for opening Utah Courts XChange case search
// with optional pre-filled parameters.
// ============================================================

export function openUtahCourtsXChange(params?: {
  lastName?: string;
  firstName?: string;
  caseNumber?: string;
}) {
  const base = 'https://www.utcourts.gov/xchange/CaseSearch';
  const sp = new URLSearchParams();
  if (params?.lastName) sp.set('lastName', params.lastName);
  if (params?.firstName) sp.set('firstName', params.firstName);
  if (params?.caseNumber) sp.set('caseNumber', params.caseNumber);
  const url = sp.toString() ? `${base}?${sp}` : base;
  window.open(url, '_blank', 'noopener,noreferrer');
}
