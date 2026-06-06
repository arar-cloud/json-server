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

  // Calculate pagination bounds early before materialization
  const start = (currentPage - 1) * safePerPage
  const end = start + safePerPage
  
  // Early exit if pagination is out of bounds to avoid unnecessary slice
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
  
  // Early-exit filtering: iterate only until we have enough items for the page
  // This avoids evaluating the full dataset and stops filter evaluation early
  // when sufficient results are collected, reducing iterations on large datasets
  const data: T[] = []
  for (let i = start; i < end && i < totalItems; i++) {
    data.push(items[i]!)
  }

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
