/**
 * Instance settings (bring-your-own keys). A singleton row (id=1) in app_settings
 * whose secret columns are encrypted at rest. Resolution at runtime: a DB value
 * wins over the matching env var, field by field — so a fresh self-host can run on
 * env only, and the Settings UI can override without touching the deploy config.
 */
import { db } from '@/db'
import { appSettings } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { env } from '@/env'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secret'
import { assertSafeOutboundUrl } from '@/lib/http/outbound-url'

const SINGLETON_ID = 1
type Row = typeof appSettings.$inferSelect

async function readRow(): Promise<Row | null> {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, SINGLETON_ID))
      .limit(1)
    return row ?? null
  } catch {
    // Table may not exist yet (migration not run) — fall back to env entirely.
    return null
  }
}

function safeDecrypt(enc: string | null | undefined): string | null {
  if (!enc) return null
  try {
    return decryptSecret(enc)
  } catch {
    return null
  }
}

export interface ResolvedConfig {
  aiBaseUrl: string | null
  aiApiKey: string | null
  aiModel: string | null
  aiClassifierModel: string | null
  meshyApiKey: string | null
  slicerUrl: string
  /** Printer profile for 3MF export. DB-only (no env fallback); null = none. */
  printerModel: string | null
  filamentColorBody: string | null
  filamentColorAccent: string | null
}

/** Runtime config used by the AI / Meshy clients. DB overrides env per field. */
export async function resolveConfig(): Promise<ResolvedConfig> {
  const row = await readRow()
  return {
    aiBaseUrl: row?.aiBaseUrl ?? env.AI_BASE_URL ?? null,
    aiApiKey: safeDecrypt(row?.aiApiKeyEnc) ?? env.AI_API_KEY ?? null,
    aiModel: row?.aiModel ?? env.AI_MODEL ?? null,
    aiClassifierModel: row?.aiClassifierModel ?? env.AI_CLASSIFIER_MODEL ?? null,
    meshyApiKey: safeDecrypt(row?.meshyApiKeyEnc) ?? env.MESHY_API_KEY ?? null,
    slicerUrl: row?.slicerUrl ?? env.SLICER_URL,
    printerModel: row?.printerModel ?? null,
    filamentColorBody: row?.filamentColorBody ?? null,
    filamentColorAccent: row?.filamentColorAccent ?? null,
  }
}

export type AiActivePath = 'byo' | 'gateway' | 'anthropic' | 'none'

export interface SettingsView {
  aiBaseUrl: string
  aiModel: string
  aiClassifierModel: string
  slicerUrl: string
  aiApiKeySet: boolean
  meshyApiKeySet: boolean
  /** True when the value currently resolves from an env var (UI shows a hint). */
  aiFromEnv: boolean
  meshyFromEnv: boolean
  /** True when slicer URL is coming from env (no DB override). */
  slicerFromEnv: boolean
  /**
   * Which credential path getModel() will actually use right now.
   * BYO (base URL + model) wins; else AI_GATEWAY_API_KEY; else ANTHROPIC_API_KEY.
   */
  aiActivePath: AiActivePath
  /** Human label for the active path (PT-BR, settings hint). */
  aiActiveHint: string
  /** Printer profile for 3MF export ('' = not set). */
  printerModel: string
  /** '#RRGGBB'; app defaults when unset in the DB. */
  filamentColorBody: string
  filamentColorAccent: string
}

/** App defaults for filament colours when unset in the DB. */
export const DEFAULT_FILAMENT_COLOR_BODY = '#3B82F6'
export const DEFAULT_FILAMENT_COLOR_ACCENT = '#22C55E'

/** Printer profiles the exporter knows how to embed in a 3MF. */
export const PRINTER_MODELS = ['bambu-h2d-04'] as const

function resolveAiActivePath(row: Row | null): AiActivePath {
  const base = row?.aiBaseUrl ?? env.AI_BASE_URL ?? null
  const model = row?.aiModel ?? env.AI_MODEL ?? null
  if (base && model) return 'byo'
  if (env.AI_GATEWAY_API_KEY?.trim()) return 'gateway'
  if (env.ANTHROPIC_API_KEY?.trim()) return 'anthropic'
  return 'none'
}

function aiActiveHint(path: AiActivePath, byoKeySet: boolean): string {
  switch (path) {
    case 'byo':
      return byoKeySet
        ? 'Ativo: provedor OpenAI-compatible (Base URL + modelo + chave).'
        : 'Ativo: provedor OpenAI-compatible (Base URL + modelo; chave opcional).'
    case 'gateway':
      return 'Ativo via variável de ambiente AI_GATEWAY_API_KEY (Vercel AI Gateway). Preencha Base URL + modelo acima para sobrescrever.'
    case 'anthropic':
      return 'Ativo via variável de ambiente ANTHROPIC_API_KEY. Preencha Base URL + modelo acima para sobrescrever.'
    default:
      return 'Nenhum modelo configurado — defina Base URL + modelo + chave, ou AI_GATEWAY_API_KEY / ANTHROPIC_API_KEY no ambiente.'
  }
}

/** Non-secret view for the Settings form — never returns plaintext secrets. */
export async function readSettingsView(): Promise<SettingsView> {
  const row = await readRow()
  const byoKeySet = !!(row?.aiApiKeyEnc || env.AI_API_KEY?.trim())
  const path = resolveAiActivePath(row)
  return {
    aiBaseUrl: row?.aiBaseUrl ?? env.AI_BASE_URL ?? '',
    aiModel: row?.aiModel ?? env.AI_MODEL ?? '',
    aiClassifierModel: row?.aiClassifierModel ?? env.AI_CLASSIFIER_MODEL ?? '',
    slicerUrl: row?.slicerUrl ?? env.SLICER_URL,
    // aiApiKeySet = BYO OpenAI-compatible key only (not gateway/anthropic).
    aiApiKeySet: byoKeySet,
    meshyApiKeySet: !!(row?.meshyApiKeyEnc || env.MESHY_API_KEY?.trim()),
    aiFromEnv: !row?.aiApiKeyEnc && !!env.AI_API_KEY?.trim(),
    meshyFromEnv: !row?.meshyApiKeyEnc && !!env.MESHY_API_KEY?.trim(),
    slicerFromEnv: !row?.slicerUrl,
    aiActivePath: path,
    aiActiveHint: aiActiveHint(path, byoKeySet),
    printerModel: row?.printerModel ?? '',
    filamentColorBody: row?.filamentColorBody ?? DEFAULT_FILAMENT_COLOR_BODY,
    filamentColorAccent: row?.filamentColorAccent ?? DEFAULT_FILAMENT_COLOR_ACCENT,
  }
}

export interface SaveSettingsInput {
  aiBaseUrl?: string
  aiModel?: string
  aiClassifierModel?: string
  slicerUrl?: string
  /** Plaintext; only written when non-empty (blank input = keep current). */
  aiApiKey?: string
  meshyApiKey?: string
  clearAiApiKey?: boolean
  clearMeshyApiKey?: boolean
  /** '' or 'none' clears; otherwise must be a known PRINTER_MODELS entry. */
  printerModel?: string
  /** '#RRGGBB'; '' clears back to the app default. */
  filamentColorBody?: string
  filamentColorAccent?: string
}

const norm = (s?: string): string | null => {
  const t = (s ?? '').trim()
  return t.length ? t : null
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** '' / 'none' → null (no printer); known model passes; anything else throws. */
function normPrinterModel(input?: string): string | null {
  const value = norm(input)
  if (value === null || value === 'none') return null
  if ((PRINTER_MODELS as readonly string[]).includes(value)) return value
  throw new Error(
    `Impressora inválida: "${value}". Valores aceitos: nenhuma ('' ou 'none') ou 'bambu-h2d-04'.`,
  )
}

/** '' → null (app default); otherwise must be '#RRGGBB'. */
function normFilamentColor(input: string | undefined, label: string): string | null {
  const value = norm(input)
  if (value === null) return null
  if (HEX_COLOR_RE.test(value)) return value
  throw new Error(`${label} inválida: "${value}". Use o formato hexadecimal #RRGGBB.`)
}

export async function saveSettings(input: SaveSettingsInput): Promise<void> {
  const existing = await readRow()
  const aiKey = norm(input.aiApiKey)
  const meshyKey = norm(input.meshyApiKey)
  const aiBaseUrl = norm(input.aiBaseUrl)
  const slicerUrl = norm(input.slicerUrl)
  // Reject cloud-metadata endpoints (SSRF) before persisting. localhost/LAN are
  // intentionally allowed (self-hosted local models).
  if (aiBaseUrl) assertSafeOutboundUrl(aiBaseUrl, 'Base URL da IA')
  if (slicerUrl) assertSafeOutboundUrl(slicerUrl, 'Slicer URL')
  const printerModel = normPrinterModel(input.printerModel)
  const filamentColorBody = normFilamentColor(input.filamentColorBody, 'Cor do corpo')
  const filamentColorAccent = normFilamentColor(input.filamentColorAccent, 'Cor do detalhe')

  const row = {
    id: SINGLETON_ID,
    aiBaseUrl,
    aiModel: norm(input.aiModel),
    aiClassifierModel: norm(input.aiClassifierModel),
    slicerUrl,
    printerModel,
    filamentColorBody,
    filamentColorAccent,
    aiApiKeyEnc: input.clearAiApiKey
      ? null
      : aiKey
        ? encryptSecret(aiKey)
        : (existing?.aiApiKeyEnc ?? null),
    meshyApiKeyEnc: input.clearMeshyApiKey
      ? null
      : meshyKey
        ? encryptSecret(meshyKey)
        : (existing?.meshyApiKeyEnc ?? null),
    updatedAt: new Date(),
  }

  await db
    .insert(appSettings)
    .values(row)
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        aiBaseUrl: row.aiBaseUrl,
        aiModel: row.aiModel,
        aiClassifierModel: row.aiClassifierModel,
        slicerUrl: row.slicerUrl,
        printerModel: row.printerModel,
        filamentColorBody: row.filamentColorBody,
        filamentColorAccent: row.filamentColorAccent,
        aiApiKeyEnc: row.aiApiKeyEnc,
        meshyApiKeyEnc: row.meshyApiKeyEnc,
        updatedAt: row.updatedAt,
      },
    })
}
