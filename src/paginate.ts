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
  
  // Security: Prevent integer overflow in pagination calculations
  if (!Number.isFinite(perPage) || perPage !== perPage) return { first: 1, prev: null, next: null, last: 1, pages: 1, items: totalItems, data: [] }
  if (!Number.isFinite(page) || page !== page) return { first: 1, prev: null, next: null, last: 1, pages: 1, items: totalItems, data: [] }
  
  const safePerPage = perPage > 0 ? Math.floor(perPage) : 1
  const pages = Math.max(1, Math.ceil(totalItems / safePerPage))

  // Ensure page is within the valid range
  const safePage = Number.isFinite(page) ? Math.floor(page) : 1
  const currentPage = Math.max(1, Math.min(safePage, pages))

  const first = 1
  const prev = currentPage > 1 ? currentPage - 1 : null
  const next = currentPage < pages ? currentPage + 1 : null
  const last = pages

  // Security: Prevent offset underflow/overflow
  const offset = (currentPage - 1) * safePerPage
  if (offset < 0 || !Number.isSafeInteger(offset)) {
    return { first, prev, next, last, pages, items: totalItems, data: [] }
  }
  
  const start = offset
  const end = Math.min(start + safePerPage, totalItems)
  const data = items.slice(start, end)

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
