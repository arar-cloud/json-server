export type PaginationResult<T> = {
  first: number
  prev: number | null
  next: number | null
  last: number
  pages: number
  items: number
  data: T[]
}

export function paginate<T>(items: T[], page: number, perPage: number): PaginationResult<T> {
  const totalItems = items.length
  const safePerPage = Number.isFinite(perPage) && perPage > 0 ? Math.floor(perPage) : 1
  const pages = Math.max(1, Math.ceil(totalItems / safePerPage))

  // Ensure page is within the valid range
  // Boundary checks: page <= 0 and perPage <= 0 handled above
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  const currentPage = Math.max(1, Math.min(safePage, pages))

  const first = 1
  const prev = currentPage > 1 ? currentPage - 1 : null
  const next = currentPage < pages ? currentPage + 1 : null
  const last = pages

  const start = (currentPage - 1) * safePerPage
  const end = start + safePerPage
  // Explicit bounds checking to prevent off-by-one errors and array overruns
  const data = items.slice(Math.max(0, start), Math.min(totalItems, end))

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
