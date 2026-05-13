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

  const start = (currentPage - 1) * safePerPage
  
  // Early termination: return empty data immediately if pagination is beyond bounds
  // This prevents unnecessary array operations on high page numbers
  if (start >= totalItems) {
    return {
      first,
      prev,
      next,
      last,
      pages,
      items: totalItems,
      data: [],
    }
  }
  
  // Offset-based pagination: slice only the requested range to avoid materializing
  // the entire dataset. This reduces memory footprint for large collections.
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
