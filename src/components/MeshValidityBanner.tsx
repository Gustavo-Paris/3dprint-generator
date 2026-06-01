'use client'
import type { MeshValidityReport } from '@/lib/mesh/validity'

/**
 * Advisory (non-blocking) banner for the mesh-validity gate (Fase C, TASK-050).
 *
 * Renders nothing when the mesh is watertight/manifold (or unknown). When it
 * isn't, it warns the user that slicing may fail — but never blocks it. Only
 * boundary holes and non-manifold edges gate the banner; degenerate triangles
 * are common and mostly harmless, so they're listed only as supplementary
 * detail when the banner is already showing for another reason.
 */
export default function MeshValidityBanner({
  report,
}: {
  report: MeshValidityReport | null
}) {
  if (!report || !report.analyzed || report.watertight) return null

  const parts: string[] = []
  if (report.nonManifoldEdges > 0) {
    const n = report.nonManifoldEdges
    parts.push(`${n} ${n === 1 ? 'aresta não-manifold' : 'arestas não-manifold'}`)
  }
  if (report.boundaryEdges > 0) {
    const n = report.boundaryEdges
    parts.push(`${n} ${n === 1 ? 'buraco' : 'buracos'}`)
  }
  if (report.degenerateTriangles > 0) {
    const n = report.degenerateTriangles
    parts.push(`${n} ${n === 1 ? 'triângulo degenerado' : 'triângulos degenerados'}`)
  }
  if (report.nonFiniteTriangles > 0) {
    const n = report.nonFiniteTriangles
    parts.push(`${n} ${n === 1 ? 'triângulo' : 'triângulos'} com coordenadas inválidas`)
  }

  return (
    <div
      role="status"
      className="absolute bottom-4 left-4 right-4 z-10 bg-amber-50 text-amber-900 border border-amber-300 rounded p-3 text-xs"
    >
      <strong>⚠ Malha não-estanque</strong> — pode falhar ou imprimir com defeitos.
      {parts.length > 0 && <span className="ml-1">{parts.join(' · ')}.</span>}
    </div>
  )
}
