/**
 * Flatten a multi-extruder mesh into a single triangle soup for single-material
 * slicing (Orca/Bambu STL path).
 *
 * Naive concatenation of A+B bodies leaves the logo as a separate shell →
 * "floating cantilever" warnings and white garbage markers in the slicer.
 * We Manifold-union every extruder group so the result is one solid.
 *
 * Falls back to concatenation if union fails (non-manifold import) so slicing
 * still has something to chew on.
 */
import type { BaseMesh } from '@/lib/import/types'

export async function flattenMeshForSlice(mesh: BaseMesh): Promise<Float32Array> {
  const byEx = new Map<'A' | 'B', number[]>()
  for (let i = 0; i < mesh.triangleCount; i++) {
    const ex = mesh.extruders[i] ?? 'A'
    let bucket = byEx.get(ex)
    if (!bucket) {
      bucket = []
      byEx.set(ex, bucket)
    }
    const o = i * 9
    for (let k = 0; k < 9; k++) bucket.push(mesh.positions[o + k])
  }

  const groups = [...byEx.values()]
    .filter((g) => g.length >= 9)
    .map((g) => new Float32Array(g))

  if (groups.length === 0) return mesh.positions
  if (groups.length === 1) return groups[0]

  const { booleanSoup } = await import('@/lib/import/manifold-csg')
  // Explicit annotation: booleanSoup returns Float32Array<ArrayBufferLike>,
  // while `groups[0]` alone would narrow `acc` to Float32Array<ArrayBuffer>.
  let acc: Float32Array = groups[0]
  for (let i = 1; i < groups.length; i++) {
    try {
      acc = await booleanSoup(acc, groups[i], 'union')
    } catch {
      // Non-manifold or empty intersection — keep both soups so we don't
      // silently drop the logo; slicer may still warn but geometry is present.
      const merged = new Float32Array(acc.length + groups[i].length)
      merged.set(acc, 0)
      merged.set(groups[i], acc.length)
      acc = merged
    }
  }
  return acc
}
