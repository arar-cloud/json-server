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
  
  // Validate boundary conditions: page and perPage must be positive finite numbers
  if (!Number.isFinite(page) || page < 1 || !Number.isFinite(perPage) || perPage < 1) {
    return {
      first: 1,
      prev: null,
      next: null,
      last: 1,
      pages: 1,
      items: totalItems,
      data: [],
    }
  }
  
  const safePerPage = Math.floor(perPage)
  const pages = Math.max(1, Math.ceil(totalItems / safePerPage))

  // Ensure page is within the valid range
  const safePage = Math.floor(page)
  const currentPage = Math.max(1, Math.min(safePage, pages))

  const first = 1
  const prev = currentPage > 1 ? currentPage - 1 : null
  const next = currentPage < pages ? currentPage + 1 : null
  const last = pages

  const start = (currentPage - 1) * safePerPage
  const end = start + safePerPage
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
