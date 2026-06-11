import { auth, signOut } from '@/auth'
import { db } from '@/db'
import { projects } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createProject } from '@/actions/projects'

export default async function Home() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  const myProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(desc(projects.updatedAt))

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Your projects</h1>
        <form
          action={async () => {
            'use server'
            await signOut({ redirectTo: '/sign-in' })
          }}
        >
          <button className="text-sm text-gray-500 hover:underline">
            {session.user.email} — sign out
          </button>
        </form>
      </header>

      <form action={createProject} className="flex gap-2">
        <input
          name="title"
          placeholder="New project title"
          className="flex-1 border rounded px-3 py-2"
        />
        <button type="submit" className="bg-black text-white rounded px-4 py-2">
          New
        </button>
      </form>

      <ul className="space-y-2">
        {myProjects.length === 0 && (
          <li className="text-gray-500 text-sm">No projects yet.</li>
        )}
        {myProjects.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="block border rounded p-3 hover:bg-gray-50">
              <div className="font-medium">{p.title}</div>
              <div className="text-xs text-gray-500">{p.updatedAt.toLocaleString()}</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
