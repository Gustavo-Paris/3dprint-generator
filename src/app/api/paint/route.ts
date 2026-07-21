/**
 * Interactive paint used to live here and repeatedly OOM'd Node on 1M+ tri
 * sculpts (load mesh + flood + write 50MB bin / 3MF).
 *
 * Paint now runs only in the browser (Web Worker). This route stays as a soft
 * failure for any stale client still posting here.
 */
import { apiError } from '@/lib/http/api-error'

export const runtime = 'nodejs'

export async function POST() {
  return apiError(
    410,
    'paint_client_only',
    'Pintura interativa roda só no browser. Use “Exportar 3MF multi-cor” no painel de pintura.',
  )
}
