/**
 * Ownership gate for a client-supplied `meshUrl` on /api/generate.
 *
 * The import flow sends a URL the server itself issued: either a prior
 * iteration's output mesh in this project (`ownMeshUrls`), or a fresh
 * `/api/upload` artifact stored under the user's OWN namespace. Anything else —
 * an arbitrary http host (SSRF), a foreign user's blob path (IDOR), or a
 * traversal-y local path — is rejected. The realpath containment in
 * load-base-mesh is the belt-and-suspenders for the local-file read.
 */
const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com'

export function isOwnMeshUrl(
  url: string,
  userId: string,
  ownMeshUrls: ReadonlySet<string>,
): boolean {
  if (ownMeshUrls.has(url)) return true

  if (url.startsWith('http://') || url.startsWith('https://')) {
    let u: URL
    try { u = new URL(url) } catch { return false }
    // Vercel Blob is always https; the artifact key is `<userId>/...`, so the
    // pathname must begin with this user's id. Ties the mesh to the caller.
    if (u.protocol !== 'https:') return false
    if (!u.hostname.toLowerCase().endsWith(BLOB_HOST_SUFFIX)) return false
    return u.pathname.startsWith(`/${userId}/`)
  }

  // Local-dev relative artifact under public/ (no blob token configured).
  if (url.includes('..') || url.includes('\\')) return false
  return url.startsWith('/uploads/') || url.startsWith('/meshes/')
}
