/**
 * Unit tests: renameProject / deleteProject server actions.
 *
 * External deps (auth, db, blob storage, next/cache) are mocked. Validates the
 * auth gate, uuid + zod title validation, ownership scoping (non-owner → throw,
 * no mutation), best-effort blob cleanup on delete, and revalidation paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const UUID = 'ec211884-b908-4057-b8d5-dba3fd9c28e2'

// ── Auth mock ────────────────────────────────────────────────────────────────
const authMock = vi.fn()
vi.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }))

// ── next/cache + next/navigation mocks ───────────────────────────────────────
const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

// ── Storage mock ─────────────────────────────────────────────────────────────
const delMeshMock = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('@/lib/storage/persist', () => ({
  delMesh: (...args: unknown[]) => delMeshMock(...args),
}))

// ── DB mock ──────────────────────────────────────────────────────────────────
// renameProject: db.update().set().where().returning()
// deleteProject: db.select().from().where().limit(1)  (ownership)
//                db.select().from().where()           (iterations, awaited raw)
//                db.delete().where()
const updateReturningMock = vi.fn(async () => [] as unknown[])
const updateSetMock = vi.fn()
const selectLimitMock = vi.fn(async () => [] as unknown[])
const selectWhereMock = vi.fn(async () => [] as unknown[])
const deleteWhereMock = vi.fn(async () => undefined)
vi.mock('@/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: (...args: unknown[]) => {
        updateSetMock(...args)
        return { where: vi.fn(() => ({ returning: updateReturningMock })) }
      },
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          // Awaited directly (iterations query) OR chained .limit(1) (ownership).
          const p = selectWhereMock() as Promise<unknown[]> & { limit: typeof selectLimitMock }
          p.limit = selectLimitMock
          return p
        }),
      })),
    })),
    delete: vi.fn(() => ({ where: deleteWhereMock })),
    insert: vi.fn(),
  },
}))

async function getActions() {
  return import('@/actions/projects')
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: 'user-1' } })
  updateReturningMock.mockResolvedValue([{ id: UUID }])
  selectLimitMock.mockResolvedValue([{ id: UUID }])
  selectWhereMock.mockResolvedValue([])
  delMeshMock.mockResolvedValue(undefined)
})

describe('renameProject', () => {
  it('throws when unauthenticated and touches nothing', async () => {
    authMock.mockResolvedValue(null)
    const { renameProject } = await getActions()
    await expect(renameProject(UUID, 'Novo título')).rejects.toThrow('Unauthenticated')
    expect(updateSetMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('rejects a non-uuid id before hitting the db', async () => {
    const { renameProject } = await getActions()
    await expect(renameProject('not-a-uuid', 'Novo')).rejects.toThrow('Not found')
    expect(updateSetMock).not.toHaveBeenCalled()
  })

  it('rejects an empty / whitespace-only title (zod)', async () => {
    const { renameProject } = await getActions()
    await expect(renameProject(UUID, '   ')).rejects.toThrow()
    expect(updateSetMock).not.toHaveBeenCalled()
  })

  it('throws when the project is not owned (update matched zero rows)', async () => {
    updateReturningMock.mockResolvedValue([])
    const { renameProject } = await getActions()
    await expect(renameProject(UUID, 'Novo')).rejects.toThrow('Not found')
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('trims the title, bumps updatedAt and revalidates home + project page', async () => {
    const { renameProject } = await getActions()
    await renameProject(UUID, '  Peça nova  ')
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Peça nova', updatedAt: expect.any(Date) }),
    )
    expect(revalidatePathMock).toHaveBeenCalledWith('/')
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${UUID}`)
  })
})

describe('deleteProject', () => {
  it('throws when unauthenticated and touches nothing', async () => {
    authMock.mockResolvedValue(null)
    const { deleteProject } = await getActions()
    await expect(deleteProject(UUID)).rejects.toThrow('Unauthenticated')
    expect(deleteWhereMock).not.toHaveBeenCalled()
    expect(delMeshMock).not.toHaveBeenCalled()
  })

  it('rejects a non-uuid id before hitting the db', async () => {
    const { deleteProject } = await getActions()
    await expect(deleteProject('../etc')).rejects.toThrow('Not found')
    expect(deleteWhereMock).not.toHaveBeenCalled()
  })

  it('throws when the project is not owned — no delete, no blob cleanup', async () => {
    selectLimitMock.mockResolvedValue([])
    const { deleteProject } = await getActions()
    await expect(deleteProject(UUID)).rejects.toThrow('Not found')
    expect(deleteWhereMock).not.toHaveBeenCalled()
    expect(delMeshMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('deletes stored meshes best-effort, then the project row, then revalidates', async () => {
    selectWhereMock.mockResolvedValue([
      { meshBlobUrl: '/meshes/a.stl', slicedBlobUrl: '/meshes/a.3mf' },
      { meshBlobUrl: 'https://blob/x.stl', slicedBlobUrl: null },
      { meshBlobUrl: null, slicedBlobUrl: null },
    ])
    const { deleteProject } = await getActions()
    await deleteProject(UUID)
    expect(delMeshMock).toHaveBeenCalledTimes(3)
    expect(delMeshMock).toHaveBeenCalledWith('/meshes/a.stl')
    expect(delMeshMock).toHaveBeenCalledWith('/meshes/a.3mf')
    expect(delMeshMock).toHaveBeenCalledWith('https://blob/x.stl')
    expect(deleteWhereMock).toHaveBeenCalledTimes(1)
    expect(revalidatePathMock).toHaveBeenCalledWith('/')
  })

  it('still deletes the project when blob cleanup fails (best-effort)', async () => {
    selectWhereMock.mockResolvedValue([
      { meshBlobUrl: 'https://blob/x.stl', slicedBlobUrl: null },
    ])
    delMeshMock.mockRejectedValue(new Error('blob down'))
    const { deleteProject } = await getActions()
    await expect(deleteProject(UUID)).resolves.toBeUndefined()
    expect(deleteWhereMock).toHaveBeenCalledTimes(1)
    expect(revalidatePathMock).toHaveBeenCalledWith('/')
  })

  it('deletes a project with zero iterations without calling delMesh', async () => {
    selectWhereMock.mockResolvedValue([])
    const { deleteProject } = await getActions()
    await deleteProject(UUID)
    expect(delMeshMock).not.toHaveBeenCalled()
    expect(deleteWhereMock).toHaveBeenCalledTimes(1)
  })
})
