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
  }
}

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
}

/** Non-secret view for the Settings form — never returns plaintext secrets. */
export async function readSettingsView(): Promise<SettingsView> {
  const row = await readRow()
  return {
    aiBaseUrl: row?.aiBaseUrl ?? env.AI_BASE_URL ?? '',
    aiModel: row?.aiModel ?? env.AI_MODEL ?? '',
    aiClassifierModel: row?.aiClassifierModel ?? env.AI_CLASSIFIER_MODEL ?? '',
    slicerUrl: row?.slicerUrl ?? env.SLICER_URL,
    aiApiKeySet: !!(row?.aiApiKeyEnc || env.AI_API_KEY),
    meshyApiKeySet: !!(row?.meshyApiKeyEnc || env.MESHY_API_KEY),
    aiFromEnv: !row?.aiApiKeyEnc && !!env.AI_API_KEY,
    meshyFromEnv: !row?.meshyApiKeyEnc && !!env.MESHY_API_KEY,
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
}

const norm = (s?: string): string | null => {
  const t = (s ?? '').trim()
  return t.length ? t : null
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

  const row = {
    id: SINGLETON_ID,
    aiBaseUrl,
    aiModel: norm(input.aiModel),
    aiClassifierModel: norm(input.aiClassifierModel),
    slicerUrl,
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
        aiApiKeyEnc: row.aiApiKeyEnc,
        meshyApiKeyEnc: row.meshyApiKeyEnc,
        updatedAt: row.updatedAt,
      },
    })
}
