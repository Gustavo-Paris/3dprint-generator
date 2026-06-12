import { sql, type InferSelectModel } from 'drizzle-orm'
import { iterations } from '@/db/schema'

/** A projected history row: every iteration column except the dead
 *  `parentIterationId`, with `validationReport` cache-stripped at the SQL level. */
export type HistoryRow = Omit<InferSelectModel<typeof iterations>, 'parentIterationId'>

/**
 * Column projection for project-history list reads (the `/projects/[id]` page).
 *
 * The full row's `validation_report` jsonb is heavy ONLY because of its cached
 * `_faces`/`_previews` keys (base64 PNGs, ≤806KB) — pulled on every project open
 * by a bare `select()`. We strip those two keys at the SQL level (`jsonb - key`)
 * but KEEP the small design payload (kind + params): `ProjectWorkspace` needs it
 * for imported-base detection (hasImportedBase → validationReport.kind) and the
 * chat design replay. The generate route's iterate path re-reads the full row
 * (caches included) via its own select, so nothing downstream loses the caches.
 *
 * `parent_iteration_id` is intentionally absent — it is dead (never written) and
 * is dropped from the schema in Task 5.3.
 */
export const historyColumns = {
  id: iterations.id,
  projectId: iterations.projectId,
  userMessage: iterations.userMessage,
  imageBlobUrl: iterations.imageBlobUrl,
  jscadCode: iterations.jscadCode,
  strategy: iterations.strategy,
  meshBlobUrl: iterations.meshBlobUrl,
  status: iterations.status,
  error: iterations.error,
  slicedBlobUrl: iterations.slicedBlobUrl,
  slicedMeta: iterations.slicedMeta,
  slicedAt: iterations.slicedAt,
  baseMode: iterations.baseMode,
  imageDescription: iterations.imageDescription,
  createdAt: iterations.createdAt,
  validationReport:
    sql<unknown>`${iterations.validationReport} - '_faces' - '_previews'`.as('validation_report'),
} as const
