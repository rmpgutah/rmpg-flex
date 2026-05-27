// ============================================================
// asArray
// ============================================================
// Defensive array coercion for API responses that should be an
// array but might come back as `null`, `undefined`, an empty
// object, or a stub shape during partial-cutover periods.
//
// Why this exists: PR #667 added ~25 proxy stubs that the new
// worker doesn't yet implement. Some return `[]` (correct), some
// return `{}` or `null`. AdminPage consumers do
// `apiFetch<T[]>('/x').then(setX)` followed by a `.map()` render,
// which crashes the entire page with
//   TypeError: u.map is not a function
// when the response shape is wrong. Wrapping the response in
// `asArray()` before setState collapses that error class.
//
// Use sites:
//   const rows = asArray(await apiFetch<Foo[]>('/foo'));
//   setFoo(asArray(await apiFetch<Foo[]>('/foo')));
//   .then((data) => setFoo(asArray(data)));
//
// The helper does NOT log a warning — silent coercion is desired
// during the strangler-fig cutover (we don't want a console flood
// for every stub-shaped response). If specific consumers want
// observability, they can log themselves before the asArray call.
// ============================================================

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
