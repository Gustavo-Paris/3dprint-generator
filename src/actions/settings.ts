'use server'
import { auth } from '@/auth'
import { isAdminEmail } from '@/env'
import { saveSettings } from '@/lib/settings/store'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function saveSettingsAction(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthenticated')
  // Settings is a shared instance singleton — admin only.
  if (!isAdminEmail(session.user.email)) throw new Error('Forbidden')

  const str = (k: string) => String(formData.get(k) ?? '')
  let errMsg: string | null = null
  try {
    await saveSettings({
      aiBaseUrl: str('aiBaseUrl'),
      aiModel: str('aiModel'),
      aiClassifierModel: str('aiClassifierModel'),
      slicerUrl: str('slicerUrl'),
      aiApiKey: str('aiApiKey'),
      meshyApiKey: str('meshyApiKey'),
      clearAiApiKey: formData.get('clearAiApiKey') === 'on',
      clearMeshyApiKey: formData.get('clearMeshyApiKey') === 'on',
    })
  } catch (e) {
    // Validation errors (e.g. blocked/invalid URL) — bounce back with a message.
    errMsg = (e as Error).message
  }
  // redirect() throws its own control-flow signal — keep it OUT of try/catch.
  if (errMsg) redirect(`/settings?error=${encodeURIComponent(errMsg)}`)
  revalidatePath('/settings')
  redirect('/settings?saved=1')
}
