'use server'
import { auth } from '@/auth'
import { db } from '@/db'
import { projects } from '@/db/schema'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createProject(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthenticated')
  const title = String(formData.get('title') ?? '').trim() || 'Projeto sem título'
  const [p] = await db
    .insert(projects)
    .values({ userId: session.user.id, title })
    .returning()
  revalidatePath('/')
  redirect(`/projects/${p.id}`)
}
