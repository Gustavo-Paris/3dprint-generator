/**
 * POST /api/print-bambu — dry-run / status for LAN Bambu handoff (rm-016).
 *
 * Never starts a real print from this route without an explicit env opt-in.
 * Default: returns setup checklist + dry_run: true.
 *
 * Body (optional): { projectId?, iterationId?, confirm?: boolean }
 */
import { auth } from '@/auth'
import { apiError } from '@/lib/http/api-error'
import { createRequestLogger } from '@/lib/log'
import { z } from 'zod'

export const runtime = 'nodejs'

const Body = z.object({
  projectId: z.string().uuid().optional(),
  iterationId: z.string().uuid().optional(),
  /** Must be true AND BAMBU_LAN_ENABLED=1 to attempt a live handoff later. */
  confirm: z.boolean().optional(),
})

export async function POST(req: Request) {
  const log = createRequestLogger('print-bambu')
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, 'unauthenticated', 'Faça login para continuar.')
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  const parsed = Body.safeParse(raw ?? {})
  if (!parsed.success) {
    return apiError(400, 'invalid_body', 'Corpo inválido.')
  }

  const lanEnabled = process.env.BAMBU_LAN_ENABLED === '1'
  const host = process.env.BAMBU_LAN_HOST?.trim() || null
  const serial = process.env.BAMBU_LAN_SERIAL?.trim() || null
  const accessCode = process.env.BAMBU_LAN_ACCESS_CODE ? '[set]' : null

  const checklist = [
    'Defina BAMBU_LAN_HOST (IP da impressora na LAN)',
    'Defina BAMBU_LAN_SERIAL e BAMBU_LAN_ACCESS_CODE (painel da Bambu)',
    'Defina BAMBU_LAN_ENABLED=1 só quando quiser permitir envio real',
    'Gere e fatie um 3MF no Studio antes de enviar',
    'Veja docs/bambu-lan-runbook.md para o fluxo timeboxed',
  ]

  if (!lanEnabled || !host || !serial || !process.env.BAMBU_LAN_ACCESS_CODE) {
    log.info('bambu dry-run (not configured)', {
      lanEnabled,
      hasHost: !!host,
      hasSerial: !!serial,
    })
    return Response.json({
      ok: true,
      dry_run: true,
      status: 'not_configured',
      message:
        'Envio à Bambu por LAN ainda não está configurado neste deploy. Use Bambu Studio ou complete o checklist.',
      checklist,
      config: { lanEnabled, host, serial, accessCode },
      iteration_id: parsed.data.iterationId ?? null,
    })
  }

  if (!parsed.data.confirm) {
    return Response.json({
      ok: true,
      dry_run: true,
      status: 'ready_for_confirm',
      message:
        'LAN configurada. Reenvie com confirm:true para um handoff real (ainda bloqueado nesta versão — use o runbook).',
      checklist: [
        'Confirme o G-code/3MF fatiado no Studio',
        'POST { confirm: true, iterationId } quando a integração live estiver ligada',
      ],
      config: { lanEnabled, host, serial, accessCode },
    })
  }

  // Live print is intentionally not wired here — FEAT-018 timebox uses the
  // external cad-workshop Bambu runbook until LAN MQTT/FTPS is productized.
  return apiError(
    501,
    'bambu_live_not_implemented',
    'Handoff live Bambu LAN ainda não está implementado no SaaS. Use o runbook e o Bambu Studio.',
  )
}
