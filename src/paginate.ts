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
  const safePage = Number.isFinite(page) ? Math.floor(page) : 1
  const currentPage = Math.max(1, Math.min(safePage, pages))

  const first = 1
  const prev = currentPage > 1 ? currentPage - 1 : null
  const next = currentPage < pages ? currentPage + 1 : null
  const last = pages

  // Lazy slice: only compute boundaries and slice the required portion
  // Avoids materializing full array; bounds-checked to prevent invalid ranges
  const start = Math.max(0, (currentPage - 1) * safePerPage)
  const end = Math.min(items.length, start + safePerPage)
  const data = end > start ? items.slice(start, end) : []
  
  // Early exit for out-of-range requests minimizes unnecessary iterations
  if (start >= items.length) return { first, prev, next, last, pages, items: totalItems, data: [] }

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
