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
  // Validate input parameters are positive integers
  if (options?._start !== undefined && (typeof options._start !== 'number' || options._start < 0 || !Number.isInteger(options._start))) {
    throw new Error('Invalid _start parameter: must be non-negative integer')
  }
  if (options?._end !== undefined && (typeof options._end !== 'number' || options._end < 0 || !Number.isInteger(options._end))) {
    throw new Error('Invalid _end parameter: must be non-negative integer')
  }
  if (options?._limit !== undefined && (typeof options._limit !== 'number' || options._limit <= 0 || !Number.isInteger(options._limit))) {
    throw new Error('Invalid _limit parameter: must be positive integer')
  }

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
