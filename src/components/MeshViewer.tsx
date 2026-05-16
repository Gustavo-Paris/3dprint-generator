'use client'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'

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
      <gridHelper args={[200, 20, '#888', '#ddd']} />
      {geometry && (
        // JSCAD is Z-up; three.js is Y-up. Rotate -90° around X so "up" agrees
        // with the viewer's natural orientation (and with the user's mental model
        // when iterating via chat).
        <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color="#3b82f6" />
        </mesh>
      )}
      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </Canvas>
  )
}
