/**
 * POST /api/lsf-maquete
 *
 * IFC → LSF print maquete (SteelPrime golden recipe).
 * Body: { projectId, ifcUrl, scale?, minTMm?, fitBed? }
 *
 * Spawns the Python worker, persists STL/3MF as a ready iteration.
 */
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { apiError } from '@/lib/http/api-error'
import { createRequestLogger } from '@/lib/log'
import { runLsfMaquette, lsfWorkerAvailable } from '@/lib/lsf/run-worker'
import { persistMesh } from '@/lib/storage/persist'
import { getPrinter, buildProjectSettings } from '@/lib/print-profile'
import {
  resolveConfig,
  DEFAULT_FILAMENT_COLOR_BODY,
  DEFAULT_FILAMENT_COLOR_ACCENT,
} from '@/lib/settings/store'
import { serialize3mf } from '@/lib/3mf/serialize-3mf'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { and, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 600

const Body = z.object({
  projectId: z.string().uuid(),
  /** Absolute URL or /uploads/… path to IFC. */
  ifcUrl: z.string().min(1),
  scale: z.number().positive().max(500).optional(),
  minTMm: z.number().positive().max(10).optional(),
  fitBed: z.boolean().optional(),
})

async function loadIfcBytes(url: string, userId: string): Promise<Uint8Array> {
  if (url.startsWith('http')) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`fetch IFC ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  // local /uploads/… under public/ (dev) or absolute blob URL (handled above)
  void userId
  const rel = url.startsWith('/') ? url.slice(1) : url
  if (rel.includes('..')) throw new Error('invalid IFC path')
  const bytes = await readFile(join(process.cwd(), 'public', rel))
  return new Uint8Array(bytes)
}

export async function POST(req: Request) {
  const log = createRequestLogger('lsf-maquete')
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, 'unauthenticated', 'Faça login para continuar.')
  }

  if (!(await lsfWorkerAvailable())) {
    return apiError(
      503,
      'lsf_worker_unavailable',
      'Worker LSF indisponível (LSF_PYTHON / LSF_WORKER).',
    )
  }

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) {
    return apiError(400, 'invalid_body', 'Requisição inválida.')
  }
  const { projectId, ifcUrl, scale, minTMm, fitBed } = parsed.data

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!project) return apiError(404, 'not_found', 'Projeto não encontrado.')

  const [iteration] = await db
    .insert(iterations)
    .values({
      projectId,
      userMessage: 'IFC → maquete LSF (golden recipe)',
      status: 'generating',
      strategy: 'lsf_maquette',
    })
    .returning()

  try {
    const ifcBytes = await loadIfcBytes(ifcUrl, session.user.id)
    log.info('running LSF worker', {
      projectId,
      iterationId: iteration.id,
      ifcBytes: ifcBytes.length,
    })

    const result = await runLsfMaquette({
      ifcBytes,
      scale: scale ?? 70,
      minTMm: minTMm ?? 1.9,
      fitBed: fitBed ?? true,
      name: `lsf_${iteration.id.slice(0, 8)}`,
    })

    // Prefer 3MF with LSF print profile when we can re-serialize; else STL bytes
    let meshBytes: Uint8Array = result.threeMf ?? result.stl
    if (!result.threeMf) {
      try {
        const mesh = await loadBaseMeshFromBytes(new Uint8Array(result.stl))
        const cfg = await resolveConfig()
        const printer = getPrinter(cfg.printerModel)
        const colors = {
          bodyHex: cfg.filamentColorBody ?? DEFAULT_FILAMENT_COLOR_BODY,
          accentHex: cfg.filamentColorAccent ?? DEFAULT_FILAMENT_COLOR_ACCENT,
        }
        meshBytes = serialize3mf(
          [{ positions: mesh.positions, extruder: 'A', label: 'LSF frame' }],
          {
            colors: { aHex: colors.bodyHex, bHex: colors.accentHex },
            projectSettings: buildProjectSettings(
              printer,
              { multicolor: false, standing: false, lsfMaquette: true },
              colors,
            ),
          },
        )
      } catch (e) {
        log.error('3mf wrap failed; keeping STL', e)
        meshBytes = result.stl
      }
    }

    const meshUrl = await persistMesh(
      meshBytes,
      session.user.id,
      projectId,
      iteration.id,
    )

    const design = {
      kind: 'lsf_maquete' as const,
      ifcUrl,
      scale: scale ?? 70,
      minTMm: minTMm ?? 1.9,
      fitBed: fitBed ?? true,
      _workerMeta: result.meta,
    }

    await db
      .update(iterations)
      .set({
        status: 'ready',
        meshBlobUrl: meshUrl,
        validationReport: design,
        strategy: 'lsf_maquette',
      })
      .where(eq(iterations.id, iteration.id))

    await db
      .update(projects)
      .set({ currentIterationId: iteration.id, updatedAt: new Date() })
      .where(eq(projects.id, projectId))

    return Response.json({
      iteration_id: iteration.id,
      mesh_url: meshUrl,
      strategy: 'lsf_maquete',
      meta: result.meta,
      design,
    })
  } catch (err) {
    log.error('lsf maquete failed', err, { iterationId: iteration.id })
    await db
      .update(iterations)
      .set({
        status: 'failed',
        error: `lsf_maquete: ${(err as Error).message}`.slice(0, 1000),
      })
      .where(eq(iterations.id, iteration.id))
    return apiError(500, 'lsf_failed', 'Não foi possível gerar a maquete LSF.', {
      iteration_id: iteration.id,
    })
  }
}
