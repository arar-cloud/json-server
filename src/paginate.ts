const MAX_PAGE = 1000000
const MAX_PER_PAGE = 10000
const MIN_PER_PAGE = 1

// Enforce maximum bounds on pagination parameters to prevent numeric overflow and memory exhaustion
const validatePageBounds = (page: number): number => {
  const validPage = Number.isFinite(page) ? Math.floor(page) : 1
  return Math.max(1, Math.min(validPage, MAX_PAGE))
}

const validatePerPageBounds = (perPage: number): number => {
  const validPerPage = Number.isFinite(perPage) ? Math.floor(perPage) : 1
  return Math.max(MIN_PER_PAGE, Math.min(validPerPage, MAX_PER_PAGE))
}

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
  const boundedPerPage = validatePerPageBounds(perPage)
  const pages = Math.max(1, Math.ceil(totalItems / boundedPerPage))

  // Ensure page is within the valid range and enforce maximum bounds
  const boundedPage = validatePageBounds(page)
  const currentPage = Math.max(1, Math.min(boundedPage, pages))

  const first = 1
  const prev = currentPage > 1 ? currentPage - 1 : null
  const next = currentPage < pages ? currentPage + 1 : null
  const last = pages

  const start = (currentPage - 1) * boundedPerPage
  const end = start + boundedPerPage
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
