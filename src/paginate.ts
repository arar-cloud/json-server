export type PaginationResult<T> = {
  first: number
  prev: number | null
  next: number | null
  last: number
  pages: number
  items: number
  data: T[]
}

// Cache last pagination result to avoid repeated slice operations on same page requests
let cachedArray: unknown[] | null = null
let cachedStart: number | undefined = undefined
let cachedEnd: number | undefined = undefined
let cachedResult: PaginationResult<unknown> | null = null

export function paginate<T>(
  array: T[],
  start: number,
  end: number,
): PaginationResult<T> {
  const total = array.length

  // Return cached result if same array (by reference) and same pagination indices
  if (
    cachedArray === array &&
    cachedStart === start &&
    cachedEnd === end &&
    cachedResult !== null
  ) {
    return cachedResult as PaginationResult<T>
  }h
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
