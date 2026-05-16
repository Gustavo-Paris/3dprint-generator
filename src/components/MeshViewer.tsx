'use client'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

// Light structural type for OrbitControls (avoids dragging in three-stdlib types).
type OrbitControlsLike = { target: THREE.Vector3; update: () => void } | null

/**
 * Compute bbox after the Z-up→Y-up rotation we apply on the mesh, then place
 * the camera so the whole object fits in view with comfortable margin.
 *
 * Without this, a real-size helmet (~280mm) eats the [80, 80, 80] default
 * camera position and the user sees solid blue (camera is inside the mesh).
 */
function FitCameraToObject({ positions }: { positions: Float32Array }) {
  const { camera, controls } = useThree() as {
    camera: THREE.PerspectiveCamera
    controls: OrbitControlsLike
  }
  const fitted = useRef<Float32Array | null>(null)

  useEffect(() => {
    if (fitted.current === positions) return
    fitted.current = positions

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    // Apply the same Z-up→Y-up rotation as the rendered mesh so bbox matches.
    geom.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
    geom.computeBoundingBox()

    const bbox = geom.boundingBox!
    const center = new THREE.Vector3()
    bbox.getCenter(center)
    const size = new THREE.Vector3()
    bbox.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z)

    // Frame the object using the camera's vertical FOV. distance = (maxDim/2) / tan(fov/2),
    // multiplied by 1.8 for breathing room and a slight oblique angle.
    const fov = (camera.fov * Math.PI) / 180
    const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.8
    const dir = new THREE.Vector3(1, 0.85, 1).normalize()
    camera.position.copy(center).addScaledVector(dir, distance)
    camera.near = Math.max(0.1, distance / 1000)
    camera.far = Math.max(2000, distance * 50)
    camera.updateProjectionMatrix()
    camera.lookAt(center)

    if (controls) {
      controls.target.copy(center)
      controls.update()
    }

    geom.dispose()
  }, [positions, camera, controls])

  return null
}

function GridForBounds({ positions }: { positions: Float32Array | null }) {
  const size = useMemo(() => {
    if (!positions) return 200
    let max = 0
    for (let i = 0; i < positions.length; i += 3) {
      max = Math.max(max, Math.abs(positions[i]), Math.abs(positions[i + 1]), Math.abs(positions[i + 2]))
    }
    // Round up to nearest 50mm, clamped to a reasonable range.
    return Math.max(100, Math.min(1000, Math.ceil((max * 2.5) / 50) * 50))
  }, [positions])
  return <gridHelper args={[size, Math.max(10, Math.round(size / 10)), '#888', '#ddd']} />
}

export default function MeshViewer({ positions }: { positions: Float32Array | null }) {
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
      <GridForBounds positions={positions} />
      {geometry && (
        // JSCAD is Z-up; three.js is Y-up. Rotate -90° around X so "up" agrees
        // with the viewer's natural orientation (and with the user's mental model
        // when iterating via chat).
        <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color="#3b82f6" />
        </mesh>
      )}
      <OrbitControls makeDefault />
      {positions && <FitCameraToObject positions={positions} />}
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </Canvas>
  )
}
