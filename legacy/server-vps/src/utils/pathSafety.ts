import path from 'path';

// CodeQL js/path-injection — Multer-generated upload paths use random
// filenames internally (crypto.randomBytes / multer dest), so they are
// safe in practice. But CodeQL's dataflow analysis treats `req.file.path`
// as user-tainted because the upload itself originates from a user.
//
// pathInside() proves containment to the analyzer: returns true only if
// `filePath` resolves to a location strictly inside `root`. Use it to
// gate fs.* sinks on multer paths (or any path derived from req).
//
// Returns false for: empty paths, paths that escape via .., paths
// resolving to root itself, or paths on a different drive.
export function pathInside(filePath: string, root: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(filePath);
  const rel = path.relative(resolvedRoot, resolvedFile);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}
