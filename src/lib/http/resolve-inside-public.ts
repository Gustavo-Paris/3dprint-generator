import { join, resolve, sep } from 'node:path'

/**
 * Resolve a public-relative URL path (e.g. `/uploads/x.png`) to an absolute
 * path under `public/`, throwing if normalisation escapes that root.
 * Pair with `realpath` in async callers to also defeat symlink escapes.
 */
export function resolveInsidePublic(url: string): string {
  const publicDir = join(process.cwd(), 'public')
  const rel = url.startsWith('/') ? url.slice(1) : url
  const abs = resolve(publicDir, rel)
  if (abs !== publicDir && !abs.startsWith(publicDir + sep)) {
    throw new Error('path escapes the public directory')
  }
  return abs
}
