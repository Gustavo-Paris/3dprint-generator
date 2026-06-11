'use client'
import { meshValidityBanner, type MeshValidityReport } from '@/lib/mesh/validity'

/**
 * Advisory (non-blocking) banner for the mesh-validity gate.
 *
 * Renders nothing when the mesh is watertight/manifold (or unknown). For small
 * openings / non-manifold edges (which OrcaSlicer auto-repairs on import — e.g.
 * a parametric plate-with-hole that slices fine despite ~88 hole-rim boundary
 * edges) it shows a calm informational note rather than an alarm. Only genuinely
 * unprintable meshes (non-finite coordinates) get a real warning. Severity logic
 * lives in `meshValidityBanner` so it stays unit-testable in the node env.
 */
export default function MeshValidityBanner({
  report,
}: {
  report: MeshValidityReport | null
}) {
  const state = meshValidityBanner(report)
  if (!state.show) return null

  const tone =
    state.tone === 'warn'
      ? 'bg-amber-50 text-amber-900 border-amber-300'
      : 'bg-sky-50 text-sky-900 border-sky-200'
  const icon = state.tone === 'warn' ? '⚠' : 'ℹ'

  return (
    <div
      role="status"
      className={`absolute bottom-4 left-4 right-4 z-10 border rounded p-3 text-xs ${tone}`}
    >
      <strong>
        {icon} {state.title}
      </strong>{' '}
      — {state.detail}
    </div>
  )
}
