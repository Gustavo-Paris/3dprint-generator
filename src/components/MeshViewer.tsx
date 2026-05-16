'use client'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

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

function DynamicGrid({ positions }: { positions: Float32Array | null }) {
  const size = useMemo(() => {
    if (!positions) return 200
    let max = 0
    for (let i = 0; i < positions.length; i += 3) {
      max = Math.max(max, Math.abs(positions[i]), Math.abs(positions[i + 1]), Math.abs(positions[i + 2]))
    }
    if (max < 1) return 4 // Meshy-scale meshes (~1 unit)
    return Math.max(50, Math.min(1000, Math.ceil((max * 2.5) / 50) * 50))
  }, [positions])
  return <gridHelper args={[size, Math.max(10, Math.round(size / 10)), '#888', '#ddd']} />
}

export default function MeshViewer({
  positions,
  fitKey,
}: {
  positions: Float32Array | null
  /** Unique key per mesh; when it changes the camera re-frames. */
  fitKey?: string
}) {
  const geometry = useMemo(() => {
    if (!positions) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.computeVertexNormals()
    return g
  }, [positions])

  return (
    <Canvas camera={{ position: [80, 80, 80], fov: 40 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[100, 100, 100]} intensity={0.8} />
      <DynamicGrid positions={positions} />
      {geometry && (
        // JSCAD is Z-up; three.js is Y-up. Rotate -90° around X so "up" agrees
        // with the viewer's natural orientation.
        <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color="#3b82f6" />
        </mesh>
      )}
      <OrbitControls makeDefault />
      {positions && fitKey && <FitCameraToObject positions={positions} fitKey={fitKey} />}
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </Canvas>
  )
}
