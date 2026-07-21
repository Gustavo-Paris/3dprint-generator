import { auth } from '@/auth'
import { isAdminEmail } from '@/env'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Brand } from '@/components/Brand'
import { readSettingsView } from '@/lib/settings/store'
import { saveSettingsAction } from '@/actions/settings'

export const metadata = { title: 'Configurações' }

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  // Instance settings are a shared singleton — admin only.
  if (!isAdminEmail(session.user.email)) redirect('/')
  const { saved, error } = await searchParams
  const s = await readSettingsView()

  const inputCls =
    'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40'
  const labelCls = 'text-sm font-medium text-slate-700'
  const hintCls = 'text-xs text-slate-500'

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="rounded-md" aria-label="Gerador 3D — início">
            <Brand />
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            ← Projetos
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Configurações</h1>
          <p className="text-sm text-slate-500">
            Conecte seu provedor de IA e sua conta Meshy. As chaves ficam guardadas
            cifradas no banco desta instância. Variáveis de ambiente servem de fallback.
          </p>
        </div>

        {saved && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Configurações salvas.
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error}
          </div>
        )}

        <form action={saveSettingsAction} className="space-y-6">
          {/* ── AI provider ─────────────────────────────────────────────── */}
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
            <div>
              <h2 className="font-semibold text-slate-900">Provedor de IA</h2>
              <p className={hintCls}>
                Qualquer endpoint compatível com a API da OpenAI — OpenAI, OpenRouter,
                Together, Groq, ou modelos locais (Ollama, LM Studio).
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="aiBaseUrl" className={labelCls}>Base URL</label>
              <input id="aiBaseUrl" name="aiBaseUrl" defaultValue={s.aiBaseUrl} className={inputCls}
                placeholder="https://api.openai.com/v1" />
              <p className={hintCls}>
                Ex.: <code>https://openrouter.ai/api/v1</code> · <code>http://localhost:11434/v1</code> (Ollama)
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="aiModel" className={labelCls}>Modelo</label>
                <input id="aiModel" name="aiModel" defaultValue={s.aiModel} className={inputCls}
                  placeholder="gpt-4o-mini" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="aiClassifierModel" className={labelCls}>Modelo classificador (opcional)</label>
                <input id="aiClassifierModel" name="aiClassifierModel" defaultValue={s.aiClassifierModel} className={inputCls}
                  placeholder="(usa o modelo principal)" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="aiApiKey" className={labelCls}>API key (provedor OpenAI-compatible)</label>
              <input id="aiApiKey" name="aiApiKey" type="password" autoComplete="off" className={inputCls}
                placeholder={s.aiFromEnv || (s.aiApiKeySet && s.aiActivePath === 'byo')
                  ? '•••••••• (definida) — deixe em branco para manter'
                  : 'sk-…'} />
              <div className="flex items-center justify-between gap-3">
                <p className={hintCls}>
                  {s.aiFromEnv
                    ? 'Chave BYO via AI_API_KEY no ambiente.'
                    : s.aiActivePath === 'byo' && s.aiApiKeySet
                      ? 'Chave BYO guardada cifrada no banco.'
                      : 'Chave BYO opcional se o endpoint não exigir auth.'}
                </p>
                {s.aiActivePath === 'byo' && s.aiApiKeySet && !s.aiFromEnv && (
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                    <input type="checkbox" name="clearAiApiKey" className="rounded border-slate-300" /> remover
                  </label>
                )}
              </div>
              <p
                className={
                  s.aiActivePath === 'none'
                    ? 'rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900'
                    : 'rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900'
                }
              >
                {s.aiActiveHint}
              </p>
            </div>
          </section>

          {/* ── Meshy ───────────────────────────────────────────────────── */}
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
            <div>
              <h2 className="font-semibold text-slate-900">Meshy (geração freeform)</h2>
              <p className={hintCls}>
                Opcional. Habilita formas orgânicas (animais, personagens) via text/image-to-3D.
                Crie uma chave em <code>meshy.ai</code>. Sem ela, pedidos orgânicos caem na primitiva mais próxima.
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="meshyApiKey" className={labelCls}>Meshy API key</label>
              <input id="meshyApiKey" name="meshyApiKey" type="password" autoComplete="off" className={inputCls}
                placeholder={s.meshyApiKeySet ? '•••••••• (definida) — deixe em branco para manter' : 'msy_…'} />
              <div className="flex items-center justify-between">
                <p className={hintCls}>
                  {s.meshyApiKeySet
                    ? (s.meshyFromEnv ? 'Definida via variável de ambiente (MESHY_API_KEY).' : 'Definida (cifrada).')
                    : 'Nenhuma chave definida.'}
                </p>
                {s.meshyApiKeySet && !s.meshyFromEnv && (
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    <input type="checkbox" name="clearMeshyApiKey" className="rounded border-slate-300" /> remover
                  </label>
                )}
              </div>
            </div>
          </section>

          {/* ── Printer ─────────────────────────────────────────────────── */}
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
            <div>
              <h2 className="font-semibold text-slate-900">Impressora</h2>
              <p className={hintCls}>
                Com a impressora definida, o 3MF baixado já abre no Bambu Studio com
                perfil de impressão curado.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="printerModel" className={labelCls}>Impressora</label>
              <select id="printerModel" name="printerModel" defaultValue={s.printerModel} className={inputCls}>
                <option value="">Nenhuma — 3MF sem perfil embutido</option>
                <option value="bambu-h2d-04">Bambu Lab H2D · bico 0.4</option>
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="filamentColorBody" className={labelCls}>Cor do corpo</label>
                <input
                  id="filamentColorBody"
                  name="filamentColorBody"
                  type="color"
                  defaultValue={s.filamentColorBody}
                  className="h-11 w-full cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="filamentColorAccent" className={labelCls}>Cor do detalhe/logo</label>
                <input
                  id="filamentColorAccent"
                  name="filamentColorAccent"
                  type="color"
                  defaultValue={s.filamentColorAccent}
                  className="h-11 w-full cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                />
              </div>
            </div>
          </section>

          {/* ── Slicer ──────────────────────────────────────────────────── */}
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
            <div>
              <h2 className="font-semibold text-slate-900">Slicer</h2>
              <p className={hintCls}>URL do microserviço de fatiamento (OrcaSlicer). Opcional.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="slicerUrl" className={labelCls}>Slicer URL</label>
              <input id="slicerUrl" name="slicerUrl" defaultValue={s.slicerUrl} className={inputCls}
                placeholder="http://localhost:8787" />
              <p className={hintCls}>
                {s.slicerFromEnv
                  ? `Valor atual vem de SLICER_URL no ambiente (${s.slicerUrl}). Local: http://localhost:8787`
                  : `Override no banco. Env SLICER_URL fica de fallback se limpar este campo.`}
              </p>
            </div>
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white shadow-soft transition hover:bg-brand-700 active:bg-brand-800"
            >
              Salvar configurações
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
