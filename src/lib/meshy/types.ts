export type MeshyStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELED'

export type MeshyTask = {
  id: string
  status: MeshyStatus
  progress: number
  task_error?: { message: string }
  model_urls?: {
    glb?: string
    fbx?: string
    obj?: string
    usdz?: string
    blend?: string
  }
}

export type MeshyResult = {
  ok: true
  stl: Uint8Array
  meta: { task_id: string; took_ms: number }
} | {
  ok: false
  error: string
}
