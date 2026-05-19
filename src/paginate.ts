export type PaginationResult<T> = {
  first: number
  prev: number | null
  next: number | null
  last: number
  pages: number
  items: number
  data: T[]
}

const MIN_PAGE = 1
const MAX_PAGE = 999999
const MIN_PER_PAGE = 1
const MAX_PER_PAGE = 10000

export function validatePaginationParams(page: number, perPage: number): { page: number; perPage: number } {
  // Validate page bounds
  if (!Number.isInteger(page) || page < MIN_PAGE || page > MAX_PAGE) {
    page = MIN_PAGE
  }

  // Validate perPage bounds
  if (!Number.isInteger(perPage) || perPage < MIN_PER_PAGE || perPage > MAX_PER_PAGE) {
    perPage = 10 // Default reasonable value
  }

  return { page, perPage }
}

export function paginate<T>(items: T[], page: number, perPage: number): PaginationResult<T> {
  const { page: validPage, perPage: validPerPage } = validatePaginationParams(page, perPage)
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
