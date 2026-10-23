export type PaginationResult<T> = {
  first: number
  prev: number | null
  next: number | null
  last: number
  pages: number
  items: number
  data: T[]
}

export type PaginationIndices = {
  start: number
  end: number
  total: number
  page: number
  perPage: number
}

export function getPaginationIndices(total: number, page: number, perPage: number): PaginationIndices {
  const safePerPage = Number.isFinite(perPage) && perPage > 0 ? Math.floor(perPage) : 1
  const pages = Math.max(1, Math.ceil(total / safePerPage))
  const safePage = Number.isFinite(page) ? Math.floor(page) : 1
  const currentPage = Math.max(1, Math.min(safePage, pages))

  const start = (currentPage - 1) * safePerPage
  const end = Math.min(start + safePerPage, total)

  return { start, end, total, page: currentPage, perPage: safePerPage }
}

export function paginate<T>(items: T[], page: number, perPage: number): PaginationResult<T> {
  const totalItems = items.length
  const indices = getPaginationIndices(totalItems, page, perPage)
  
  const first = 1
  const pages = Math.max(1, Math.ceil(totalItems / indices.perPage))
  const prev = indices.page > 1 ? indices.page - 1 : null
  const next = indices.page < pages ? indices.page + 1 : null
  const last = pages

  // Index-based pagination: caller can now use indices for iteration without copying
  // slice() limited to [start, end) range only - O(perPage) memory cost
  const data = items.slice(indices.start, indices.end)

  return {
    first,
    prev,
    next,
    last,
    pages,
    items: totalItems,
    data,
  }
}
