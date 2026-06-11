/**
 * Flexify — top-level entry point.
 *
 * Given a fused Meshy octopus mesh + a working flexi reference (Rocktopus),
 * produce a multi-body .3mf where each Rocktopus component is replaced
 * with a hybrid body: Meshy aesthetic + Rocktopus joint geometry.
 *
 * Pipeline (F1..F6):
 *   F1  alignMeshes        — center + scale Rocktopus to Meshy's footprint
 *   F2  decompose          — split Rocktopus into 41 disjoint components
 *   F2  buildConnectionGraph — pairs of adjacent components + joint centers
 *   F3  chunkMeshByComponents — bucket every Meshy triangle to a component
 *   F4  buildJointDonations  — harvest Rocktopus joint triangles per joint
 *   F5  assembleBodies     — combine chunks + donations per component
 *   F6  serialize3mf       — pack the 41 bodies as a multi-object 3MF
 */
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { serialize3mf, type MeshBodyData } from '@/lib/3mf/serialize-3mf'
import { alignMeshes } from './align'
import { decompose, buildConnectionGraph } from './decompose'
import { chunkMeshByComponents } from './chunk'
import { buildJointDonations } from './joints'
import { assembleBodies } from './assemble'

export interface FlexifyOptions {
  /** AABB padding (mm) for Meshy → component chunking. Default 1.5. */
  chunkPaddingMm?: number
  /** Multiplier on the smaller component's min bbox dim for joint radius. Default 0.7. */
  jointRadiusFactor?: number
}

export interface FlexifyReport {
  componentCount: number
  jointCount: number
  totalTriangles: number
  fallbackComponents: number[]
  meshyTriangleCount: number
  rocktopusTriangleCount: number
  rocktopusScale: number
}

export async function flexify(
  meshyBytes: Uint8Array,
  rocktopusBytes: Uint8Array,
  opts: FlexifyOptions = {},
): Promise<{ bytes: Uint8Array; report: FlexifyReport }> {
  const meshyOriginal = await loadBaseMeshFromBytes(meshyBytes)
  const rocktopusOriginal = await loadBaseMeshFromBytes(rocktopusBytes)

  const { meshy, rocktopus, rocktopusScale } = alignMeshes(meshyOriginal, rocktopusOriginal)
  const components = decompose(rocktopus)
  const connections = buildConnectionGraph(rocktopus, components)
  const chunks = chunkMeshByComponents(meshy, components, { paddingMm: opts.chunkPaddingMm })
  const donations = buildJointDonations(rocktopus, components, connections, {
    radiusFactor: opts.jointRadiusFactor,
  })
  const bodies = assembleBodies(rocktopus, components, connections, chunks, donations)

  // Convert AssembledBody[] → MeshBodyData[] for the serializer.
  // Each body picks the most common extruder among its triangles (the serializer
  // tags the whole body with one extruder; per-triangle painting is out of scope).
  const meshBodies: MeshBodyData[] = bodies.map((b) => {
    let aCount = 0, bCount = 0
    for (const e of b.extruders) {
      if (e === 'A') aCount++
      else bCount++
    }
    return {
      positions: b.positions,
      extruder: aCount >= bCount ? 'A' : 'B',
      label: b.componentId === 0 ? 'Body' : `Tentacle segment ${b.componentId}`,
    }
  })

  const bytes = serialize3mf(meshBodies)

  return {
    bytes,
    report: {
      componentCount: bodies.length,
      jointCount: connections.length,
      totalTriangles: bodies.reduce((s, b) => s + b.triangleCount, 0),
      fallbackComponents: bodies.filter((b) => b.fallbackUsed).map((b) => b.componentId),
      meshyTriangleCount: meshyOriginal.triangleCount,
      rocktopusTriangleCount: rocktopusOriginal.triangleCount,
      rocktopusScale,
    },
  }
}
