import { env } from '@/env'

export type SliceResult = {
  bytes: Uint8Array
  meta: {
    print_time_min: number | null
    filament_g: number | null
  }
}

export async function sliceStl(stl: Uint8Array): Promise<SliceResult> {
  const stl_base64 = Buffer.from(stl).toString('base64')
  const res = await fetch(`${env.SLICER_URL}/slice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stl_base64 }),
  })

  if (!res.ok) {
    const errorBody = await res.text()
    throw new Error(`Slicer ${res.status}: ${errorBody.slice(0, 1000)}`)
  }

  const json = (await res.json()) as {
    bytes_base64: string
    meta: SliceResult['meta']
  }
  return {
    bytes: Buffer.from(json.bytes_base64, 'base64'),
    meta: json.meta,
  }
}
