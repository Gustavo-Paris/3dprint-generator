'use client'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import * as THREE from 'three'

export interface MeshViewerHandle {
  capturePreviews: () => Promise<{ top: string; front: string; right: string; iso: string }>
}

type OrbitControlsLike = { target: THREE.Vector3; update: () => void } | null

/**
 * Fit the camera to the mesh bbox. Triggered by `fitKey` change so the user's
 * manual orbit/zoom is preserved while interacting with the SAME mesh — we
 * only re-frame when a new iteration arrives.
 *
 * Why: Meshy meshes come in tiny normalized units (~1-2), while JSCAD meshes
 * are in mm (10-300). A single hardcoded camera position can't see both.
 */
function FitCameraToObject({
  positions,
  fitKey,
}: {
  positions: Float32Array
  fitKey: string
}) {
  const { camera, controls } = useThree() as {
    camera: THREE.PerspectiveCamera
    controls: OrbitControlsLike
  }
  const lastFitKey = useRef<string | null>(null)

  // eslint-disable-next-line react-hooks/immutability -- r3f camera is an external imperative three.js object; mutating it inside an effect is the canonical fit-to-bbox pattern
  useEffect(() => {
    if (lastFitKey.current === fitKey) return
    lastFitKey.current = fitKey

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
    geom.computeBoundingBox()

    const bbox = geom.boundingBox!
    const center = new THREE.Vector3()
    bbox.getCenter(center)
    const size = new THREE.Vector3()
    bbox.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z) || 1

    const fov = (camera.fov * Math.PI) / 180
    const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.4
    const dir = new THREE.Vector3(1, 0.85, 1).normalize()
    camera.position.copy(center).addScaledVector(dir, distance)
    // eslint-disable-next-line react-hooks/immutability -- near/far must be set imperatively on the r3f-managed camera; there is no declarative alternative for re-framing
    camera.near = Math.max(0.001, distance / 1000)
    camera.far = Math.max(2000, distance * 50)
    camera.updateProjectionMatrix()
    camera.lookAt(center)

    if (controls) {
      controls.target.copy(center)
      controls.update()
    }

    geom.dispose()
  }, [fitKey, positions, camera, controls])

  return null
}

/** Pure: map a mesh's max absolute coordinate to a grid size.
 *  Meshy meshes arrive sub-unit (~1); JSCAD meshes are mm (10-300). */
export function gridSizeFromExtent(maxAbs: number): number {
  if (maxAbs < 1) return 4 // Meshy-scale meshes (~1 unit)
  return Math.max(50, Math.min(1000, Math.ceil((maxAbs * 2.5) / 50) * 50))
}

function DynamicGrid({ positions }: { positions: Float32Array | null }) {
  const size = useMemo(() => {
    if (!positions) return 200
    // Reuse three's native min/max pass instead of a JS per-vertex loop.
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.computeBoundingBox()
    const box = geom.boundingBox!
    const maxAbs = Math.max(
      Math.abs(box.min.x), Math.abs(box.max.x),
      Math.abs(box.min.y), Math.abs(box.max.y),
      Math.abs(box.min.z), Math.abs(box.max.z),
    )
    geom.dispose()
    return gridSizeFromExtent(maxAbs)
  }, [positions])
  return <gridHelper args={[size, Math.max(10, Math.round(size / 10)), '#888', '#ddd']} />
}

export interface MeshBody {
  positions: Float32Array
  extruder: 'A' | 'B'
  label: string
}

interface MeshViewerProps {
  positions: Float32Array | null
  bodies?: MeshBody[] | null
  /** Unique key per mesh; when it changes the camera re-frames. */
  fitKey?: string
  bodyColor?: string
  logoColor?: string
  /** Click-to-place: when true, clicking the mesh reports the hit point +
   *  surface normal (in mesh/JSCAD space) via onPick. */
  pickMode?: boolean
  onPick?: (point: [number, number, number], normal: [number, number, number]) => void
  /** Mesh-space point to mark with a sphere (the last pick). */
  pickMarker?: [number, number, number] | null
}

/**
 * Inner helper rendered inside <Canvas>. Uses useThree() to access the WebGL
 * renderer and camera, then exposes capturePreviews() via an imperative handle
 * so MeshViewer (outside the Canvas) can delegate to it.
 */
/** Target preview size (px) — small enough to stay well under the LLM's
 *  context-window image budget. 4 previews × 512² ≈ a few thousand vision
 *  tokens. Going larger (e.g. 1920²) blows past the 1M-token limit. */
const PREVIEW_SIZE = 512

const CaptureHelper = forwardRef<MeshViewerHandle>(function CaptureHelper(_props, ref) {
  const { gl, camera, scene } = useThree()

  useImperativeHandle(ref, () => ({
    capturePreviews: async () => {
      // Determine a sensible orbit radius from the current camera position.
      const d = camera.position.length() || 100

      // Reusable downscale canvas — captures the renderer's full-res canvas
      // and draws it scaled into a fixed 512×512 PNG.
      const downscale = document.createElement('canvas')
      downscale.width = PREVIEW_SIZE
      downscale.height = PREVIEW_SIZE
      const dctx = downscale.getContext('2d')
      if (!dctx) throw new Error('2d context unavailable for preview downscale')

      const captureAt = (pos: [number, number, number]): string => {
        camera.position.set(pos[0], pos[1], pos[2])
        camera.lookAt(0, 0, 0)
        camera.updateMatrixWorld()
        gl.render(scene, camera)
        dctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE)
        dctx.drawImage(gl.domElement, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE)
        return downscale.toDataURL('image/png')
      }

      return {
        iso:   captureAt([d,    -d,    d]),
        top:   captureAt([0,     0,    d * 1.5]),
        front: captureAt([0,    -d * 1.5, 0]),
        right: captureAt([d * 1.5, 0,  0]),
      }
    },
  }), [gl, camera, scene])

  return null
})
CaptureHelper.displayName = 'CaptureHelper'

const MeshViewerInner = forwardRef<MeshViewerHandle, MeshViewerProps>(function MeshViewerInner({
  positions,
  bodies,
  fitKey,
  bodyColor = '#3b82f6',
  logoColor = '#f8fafc',
  pickMode = false,
  onPick,
  pickMarker = null,
}, ref) {
  const parsedBodies = useMemo(() => {
    if (bodies && bodies.length > 0) return bodies
    if (positions) {
      return [
        {
          positions,
          extruder: 'A' as const,
          label: 'Body',
        },
      ]
    }
    return []
  }, [positions, bodies])

  const geometries = useMemo(() => {
    return parsedBodies.map((body) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(body.positions, 3))
      g.computeVertexNormals()
      return {
        geometry: g,
        extruder: body.extruder,
      }
    })
  }, [parsedBodies])

  // Clean up geometries on unmount / change
  useEffect(() => {
    return () => {
      for (const g of geometries) {
        g.geometry.dispose()
      }
    }
  }, [geometries])

  return (
    <Canvas
      camera={{ position: [80, 80, 80], fov: 40 }}
      aria-label="Visualização 3D do modelo. Arraste para girar, role para dar zoom."
      role="img"
      fallback={<span>Visualização 3D indisponível neste navegador.</span>}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[100, 100, 100]} intensity={0.8} />
      <DynamicGrid positions={positions} />
      {geometries.map((g, idx) => (
        // JSCAD is Z-up; three.js is Y-up. Rotate -90° around X so "up" agrees
        // with the viewer's natural orientation.
        <mesh
          key={idx}
          geometry={g.geometry}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerDown={(e) => {
            if (!pickMode || !onPick) return
            e.stopPropagation()
            // Convert world hit point → mesh/JSCAD space (undo the -90°X). The
            // raycast face normal is already in geometry/local (= mesh) space.
            const local = e.object.worldToLocal(e.point.clone())
            const n = e.face?.normal ? e.face.normal.clone() : new THREE.Vector3(0, 0, 1)
            onPick([local.x, local.y, local.z], [n.x, n.y, n.z])
          }}
        >
          <meshStandardMaterial
            color={g.extruder === 'B' ? logoColor : bodyColor} // Custom body and logo colors
            roughness={0.5}
            metalness={0.1}
          />
        </mesh>
      ))}
      {pickMarker && (
        // Marker lives in the same rotated frame as the meshes so a mesh-space
        // point maps to the right spot.
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <mesh position={pickMarker}>
            <sphereGeometry args={[1.2, 16, 16]} />
            <meshStandardMaterial color="#f97316" emissive="#f97316" emissiveIntensity={0.5} />
          </mesh>
        </group>
      )}
      <OrbitControls makeDefault />
      {positions && fitKey && <FitCameraToObject positions={positions} fitKey={fitKey} />}
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
      <CaptureHelper ref={ref} />
    </Canvas>
  )
})
MeshViewerInner.displayName = 'MeshViewer'

export default MeshViewerInner
