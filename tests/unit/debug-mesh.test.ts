import { describe, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseBinarySTL } from '@/lib/jscad/runner'
import { extrudeLogo } from '@/lib/logo-extrude/extrude'
import * as jscadNs from '@jscad/modeling'
import type { LogoSpec } from '@/lib/design/schema'
import type { Geom3 } from '@jscad/modeling/src/geometries/geom3'
import { serializeBinarySTL } from '@/lib/stl/serialize'

type JscadShape = {
  primitives: typeof import('@jscad/modeling').primitives
  booleans: typeof import('@jscad/modeling').booleans
  geometries: typeof import('@jscad/modeling').geometries
  transforms: typeof import('@jscad/modeling').transforms
  expansions: typeof import('@jscad/modeling').expansions
  extrusions: typeof import('@jscad/modeling').extrusions
}
const jscad: JscadShape =
  ((jscadNs as unknown as { default?: JscadShape }).default ??
    (jscadNs as unknown as JscadShape))
const { primitives, booleans, geometries, transforms } = jscad

function geom3ToPositions(g: Geom3): Float32Array {
  const polys = geometries.geom3.toPolygons(g)
  const out: number[] = []
  for (const poly of polys) {
    const verts = poly.vertices
    for (let i = 1; i < verts.length - 1; i++) {
      for (const v of [verts[0], verts[i], verts[i + 1]]) {
        out.push(v[0], v[1], v[2])
      }
    }
  }
  return new Float32Array(out)
}

function geom3ToStl(g: Geom3): Uint8Array {
  const positions = geom3ToPositions(g)
  return serializeBinarySTL(Array.from(positions))
}

function trianglesToGeom3(flatTriangles: number[] | Float32Array): Geom3 {
  type Vec3 = [number, number, number]
  const polygons: Array<{ vertices: Vec3[] }> = []
  for (let i = 0; i < flatTriangles.length; i += 9) {
    polygons.push({
      vertices: [
        [flatTriangles[i], flatTriangles[i + 1], flatTriangles[i + 2]],
        [flatTriangles[i + 3], flatTriangles[i + 4], flatTriangles[i + 5]],
        [flatTriangles[i + 6], flatTriangles[i + 7], flatTriangles[i + 8]],
      ],
    })
  }
  return geometries.geom3.create(polygons)
}

function alignFlatLogo(
  logoTris: Float32Array,
  thicknessMm: number,
  logo: LogoSpec,
  slabT: number,
  overshoot: number
): number[] {
  const topZ = thicknessMm / 2
  const bottomZ = -thicknessMm / 2
  const isBottom = logo.position === 'bottom_face'
  const zFace = isBottom ? bottomZ : topZ

  const dzMid =
    logo.treatment === 'through_cut' ? 0
    : logo.treatment === 'embossed'
      ? (isBottom ? zFace + overshoot - slabT / 2 : zFace - overshoot + slabT / 2)
      : /* engraved */
        (isBottom ? zFace - overshoot / 2 + slabT / 2 : zFace + overshoot / 2 - slabT / 2)

  const winding: number[] = []
  for (let i = 0; i < logoTris.length; i += 9) {
    if (isBottom) {
      const order = [0, 2, 1]
      for (const v of order) {
        const x = -logoTris[i + v * 3]
        const y = logoTris[i + v * 3 + 1]
        const z = logoTris[i + v * 3 + 2]
        winding.push(x, z, -y + dzMid)
      }
    } else {
      const order = [0, 2, 1]
      for (const v of order) {
        const x = logoTris[i + v * 3]
        const y = logoTris[i + v * 3 + 1]
        const z = logoTris[i + v * 3 + 2]
        winding.push(x, z, y + dzMid)
      }
    }
  }
  return winding
}

function alignFlatLogoGeom3(
  logoGeom3: Geom3,
  thicknessMm: number,
  logo: LogoSpec,
  slabT: number,
  overshoot: number
): Geom3 {
  const topZ = thicknessMm / 2
  const bottomZ = -thicknessMm / 2
  const isBottom = logo.position === 'bottom_face'
  const zFace = isBottom ? bottomZ : topZ

  const dzMid =
    logo.treatment === 'through_cut' ? 0
    : logo.treatment === 'embossed'
      ? (isBottom ? zFace + overshoot - slabT / 2 : zFace - overshoot + slabT / 2)
      : /* engraved */
        (isBottom ? zFace - overshoot / 2 + slabT / 2 : zFace + overshoot / 2 - slabT / 2)

  let aligned = transforms.rotateX(-Math.PI / 2, logoGeom3)
  if (isBottom) {
    aligned = transforms.mirrorX(aligned)
  } else {
    aligned = transforms.mirrorZ(aligned)
  }

  return transforms.translate([0, 0, dzMid], aligned)
}

function checkMeshStats(label: string, g: Geom3) {
  const polys = geometries.geom3.toPolygons(g)
  const pos: number[] = []
  for (const poly of polys) {
    const verts = poly.vertices
    for (let i = 1; i < verts.length - 1; i++) {
      for (const v of [verts[0], verts[i], verts[i + 1]]) {
        pos.push(v[0], v[1], v[2])
      }
    }
  }

  let maxVerts = 0
  let nonTriangles = 0
  for (const poly of polys) {
    const vc = poly.vertices.length
    if (vc > maxVerts) maxVerts = vc
    if (vc > 3) nonTriangles++
  }

  // Weld vertices using a tolerance of 1e-5
  const uniqueVerts: [number, number, number][] = []
  const getVertexIndex = (x: number, y: number, z: number) => {
    for (let i = 0; i < uniqueVerts.length; i++) {
      const uv = uniqueVerts[i]
      if (Math.abs(uv[0] - x) < 1e-5 && Math.abs(uv[1] - y) < 1e-5 && Math.abs(uv[2] - z) < 1e-5) {
        return i
      }
    }
    uniqueVerts.push([x, y, z])
    return uniqueVerts.length - 1
  }

  const undirectedEdges = new Map<string, number>()

  for (let i = 0; i < pos.length; i += 9) {
    const idx0 = getVertexIndex(pos[i], pos[i + 1], pos[i + 2])
    const idx1 = getVertexIndex(pos[i + 3], pos[i + 4], pos[i + 5])
    const idx2 = getVertexIndex(pos[i + 6], pos[i + 7], pos[i + 8])

    const edges = [
      [idx0, idx1],
      [idx1, idx2],
      [idx2, idx0],
    ]

    for (const [from, to] of edges) {
      const uKey = from < to ? `${from}_${to}` : `${to}_${from}`
      undirectedEdges.set(uKey, (undirectedEdges.get(uKey) || 0) + 1)
    }
  }

  let boundaryEdges = 0
  let nonManifoldEdges = 0
  const printedBoundaries: string[] = []
  for (const [key, count] of undirectedEdges.entries()) {
    if (count === 1) {
      boundaryEdges++
      if (printedBoundaries.length < 5) {
        const [fromIdx, toIdx] = key.split('_').map(Number)
        const fromV = uniqueVerts[fromIdx]
        const toV = uniqueVerts[toIdx]
        printedBoundaries.push(`${fromV[0].toFixed(8)},${fromV[1].toFixed(8)},${fromV[2].toFixed(8)} -> ${toV[0].toFixed(8)},${toV[1].toFixed(8)},${toV[2].toFixed(8)}`)
      }
    } else if (count > 2) {
      nonManifoldEdges++
    }
  }

  console.log(`[Stats] ${label}: ${polys.length} polys (max verts: ${maxVerts}, non-tris: ${nonTriangles}), ${pos.length / 9} tris, ${boundaryEdges} boundary, ${nonManifoldEdges} non-manifold`)
  if (boundaryEdges > 0) {
    console.log(`  Sample boundary edges:`, printedBoundaries)
  }
}

describe('debug-mesh', () => {
  it('checks individual geometries before subtraction', async () => {
    const logoPath = '/Users/gustavoparis/.gemini/antigravity-cli/brain/4c7fa8d1-3b3c-482a-9ebd-d62e5e287654/logo3.png'
    const logoBuffer = readFileSync(logoPath)

    const sizeRatio = 0.8
    const baseSize = 50
    const targetMaxDim = baseSize * sizeRatio
    const thicknessMm = 4
    const overshoot = 0.5
    const slabT = thicknessMm + overshoot * 2

    const logoResult = await extrudeLogo({
      imageBuffer: logoBuffer,
      targetMaxDim,
      depthMm: slabT,
      ignoreHolesSmallerThan: 0,
      binaryThreshold: 200,
      addBridges: true,
      texture: 'none',
    })

    let solid: Geom3 = primitives.roundedCuboid({ size: [50, 50, thicknessMm], roundRadius: 1.5 })
    solid = transforms.translate([0, 0, -thicknessMm / 2], solid)

    const logoGeom3 = alignFlatLogoGeom3(logoResult.geom3, thicknessMm, { treatment: 'through_cut', position: 'top_face', sizeRatio: 0.8, extruder: 'B', addBridges: false, texture: 'none' }, slabT, overshoot)
    
    checkMeshStats('Solid Plate (before)', solid)
    checkMeshStats('LogoGeom3 (before)', logoGeom3)

    const result = booleans.subtract(solid, logoGeom3)
    checkMeshStats('Subtracted Result (geom3)', result)

    // Export to STL and check boundary edges of the final STL triangles
    const stlBytes = geom3ToStl(result)
    const stlTris = parseBinarySTL(stlBytes)
    
    // Weld vertices on the STL triangles
    const uniqueStlVerts: [number, number, number][] = []
    const getStlVertexIndex = (x: number, y: number, z: number) => {
      for (let i = 0; i < uniqueStlVerts.length; i++) {
        const uv = uniqueStlVerts[i]
        if (Math.abs(uv[0] - x) < 1e-5 && Math.abs(uv[1] - y) < 1e-5 && Math.abs(uv[2] - z) < 1e-5) {
          return i
        }
      }
      uniqueStlVerts.push([x, y, z])
      return uniqueStlVerts.length - 1
    }

    const stlEdges = new Map<string, number>()
    for (let i = 0; i < stlTris.length; i += 9) {
      const idx0 = getStlVertexIndex(stlTris[i], stlTris[i + 1], stlTris[i + 2])
      const idx1 = getStlVertexIndex(stlTris[i + 3], stlTris[i + 4], stlTris[i + 5])
      const idx2 = getStlVertexIndex(stlTris[i + 6], stlTris[i + 7], stlTris[i + 8])
      const edges = [
        [idx0, idx1],
        [idx1, idx2],
        [idx2, idx0],
      ]
      for (const [from, to] of edges) {
        const uKey = from < to ? `${from}_${to}` : `${to}_${from}`
        stlEdges.set(uKey, (stlEdges.get(uKey) || 0) + 1)
      }
    }

    let stlBoundaryEdges = 0
    let stlNonManifoldEdges = 0
    for (const count of stlEdges.values()) {
      if (count === 1) {
        stlBoundaryEdges++
      } else if (count > 2) {
        stlNonManifoldEdges++
      }
    }
    console.log(`[STL Stats - New Native Method] Subtracted STL: ${stlTris.length / 9} tris, ${stlBoundaryEdges} boundary edges, ${stlNonManifoldEdges} non-manifold edges`)

    // --- Old Triangle Soup Method ---
    // This simulates the current generate.ts pipeline:
    const logoTrisOld = parseBinarySTL(logoResult.stl)
    const windingOld = alignFlatLogo(logoTrisOld, thicknessMm, { treatment: 'through_cut', position: 'top_face', sizeRatio: 0.8, extruder: 'B', addBridges: false, texture: 'none' }, slabT, overshoot)
    const logoGeom3Old = trianglesToGeom3(windingOld)
    const resultOld = booleans.subtract(solid, logoGeom3Old)
    const stlBytesOld = geom3ToStl(resultOld)
    const stlTrisOld = parseBinarySTL(stlBytesOld)

    // Weld vertices on the old method's STL triangles
    const uniqueStlVertsOld: [number, number, number][] = []
    const getStlVertexIndexOld = (x: number, y: number, z: number) => {
      for (let i = 0; i < uniqueStlVertsOld.length; i++) {
        const uv = uniqueStlVertsOld[i]
        if (Math.abs(uv[0] - x) < 1e-5 && Math.abs(uv[1] - y) < 1e-5 && Math.abs(uv[2] - z) < 1e-5) {
          return i
        }
      }
      uniqueStlVertsOld.push([x, y, z])
      return uniqueStlVertsOld.length - 1
    }

    const stlEdgesOld = new Map<string, number>()
    for (let i = 0; i < stlTrisOld.length; i += 9) {
      const idx0 = getStlVertexIndexOld(stlTrisOld[i], stlTrisOld[i + 1], stlTrisOld[i + 2])
      const idx1 = getStlVertexIndexOld(stlTrisOld[i + 3], stlTrisOld[i + 4], stlTrisOld[i + 5])
      const idx2 = getStlVertexIndexOld(stlTrisOld[i + 6], stlTrisOld[i + 7], stlTrisOld[i + 8])
      const edges = [
        [idx0, idx1],
        [idx1, idx2],
        [idx2, idx0],
      ]
      for (const [from, to] of edges) {
        const uKey = from < to ? `${from}_${to}` : `${to}_${from}`
        stlEdgesOld.set(uKey, (stlEdgesOld.get(uKey) || 0) + 1)
      }
    }

    let stlBoundaryEdgesOld = 0
    let stlNonManifoldEdgesOld = 0
    for (const count of stlEdgesOld.values()) {
      if (count === 1) {
        stlBoundaryEdgesOld++
      } else if (count > 2) {
        stlNonManifoldEdgesOld++
      }
    }
    console.log(`[STL Stats - Old Soup Method] Subtracted STL: ${stlTrisOld.length / 9} tris, ${stlBoundaryEdgesOld} boundary edges, ${stlNonManifoldEdgesOld} non-manifold edges`)
  })
})
