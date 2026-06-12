import { basename } from 'node:path'

/**
 * Disk basenames with no iteration row pointing at them (matched by trailing
 * basename, so both local `/meshes/x.stl` and blob `.../u/p/x.3mf` referents
 * count). Pure set-diff — kept out of the script so it is unit-testable without
 * the script's DB/FS imports or its `main()` auto-run.
 */
export function findOrphans(diskBasenames: string[], referencedUrls: string[]): string[] {
  const ref = new Set(referencedUrls.map((u) => basename(u)))
  return diskBasenames.filter((f) => !ref.has(f))
}
