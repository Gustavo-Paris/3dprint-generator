export const PAGE_SIZE = 20

export type Pagination = {
  page: number
  offset: number
  limit: number
  hasPrev: boolean
  hasNext: boolean
}

/** Parse a `?page=` value (string | string[] | undefined) against a known total. */
export function paginate(raw: string | string[] | undefined, total: number): Pagination {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number.parseInt(value ?? '', 10)
  const page = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
  const offset = (page - 1) * PAGE_SIZE
  return {
    page,
    offset,
    limit: PAGE_SIZE,
    hasPrev: page > 1,
    hasNext: offset + PAGE_SIZE < total,
  }
}
