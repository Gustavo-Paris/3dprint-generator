/**
 * Local (non-Blob) asset storage for meshes and uploads.
 *
 * Files live OUTSIDE `public/` so Next.js never serves them as static assets
 * (which would bypass auth and ignore gzip). URLs stay `/meshes/…` and
 * `/uploads/…` — only the route handlers in `src/app/{meshes,uploads}/` read
 * the bytes after session checks.
 *
 * Override roots with MESH_STORAGE_DIR / UPLOAD_STORAGE_DIR (Railway: /data/…).
 * Legacy fallback: still read from public/meshes|uploads if present.
 */
import { basename, join, resolve, sep } from 'node:path'
import { access } from 'node:fs/promises'

export function meshStorageDir(): string {
  return process.env.MESH_STORAGE_DIR?.trim() || join(process.cwd(), '.data', 'meshes')
}

export function uploadStorageDir(): string {
  return process.env.UPLOAD_STORAGE_DIR?.trim() || join(process.cwd(), '.data', 'uploads')
}

function safeName(file: string): string {
  const name = basename(file)
  if (name !== file || name.includes('..')) {
    throw new Error('invalid asset name')
  }
  return name
}

/** Absolute path for a new write under the canonical mesh dir. */
export function meshWritePath(iterationFile: string): string {
  return join(meshStorageDir(), safeName(iterationFile))
}

export function uploadWritePath(file: string): string {
  return join(uploadStorageDir(), safeName(file))
}

/**
 * Resolve a local asset URL to an absolute path, trying the private store first
 * then legacy public/ for files written before this change.
 */
export async function resolveLocalAssetPath(url: string): Promise<string> {
  if (url.startsWith('/meshes/')) {
    const name = safeName(url.slice('/meshes/'.length))
    const primary = join(meshStorageDir(), name)
    if (await exists(primary)) return primary
    const legacy = join(process.cwd(), 'public', 'meshes', name)
    if (await exists(legacy)) return legacy
    return primary // caller will ENOENT
  }
  if (url.startsWith('/uploads/')) {
    const name = safeName(url.slice('/uploads/'.length))
    const primary = join(uploadStorageDir(), name)
    if (await exists(primary)) return primary
    const legacy = join(process.cwd(), 'public', 'uploads', name)
    if (await exists(legacy)) return legacy
    return primary
  }
  // Other public-relative paths (rare) — keep under public/ with escape check.
  const publicDir = join(process.cwd(), 'public')
  const rel = url.startsWith('/') ? url.slice(1) : url
  const abs = resolve(publicDir, rel)
  if (abs !== publicDir && !abs.startsWith(publicDir + sep)) {
    throw new Error('path escapes the public directory')
  }
  return abs
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}
