'use server'
import { auth } from '@/auth'
import { saveSettings } from '@/lib/settings/store'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function saveSettingsAction(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthenticated')
  const str = (k: string) => String(formData.get(k) ?? '')
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
  revalidatePath('/settings')
  redirect('/settings?saved=1')
}
