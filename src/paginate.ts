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
  }

  const safeStart = Number.isFinite(start) && start >= 0 ? Math.floor(start) : 0
  const safeEnd = Number.isFinite(end) && end >= safeStart ? Math.floor(end) : safeStart
  const data = array.slice(safeStart, safeEnd)

  const pages = 1
  const first = 1
  const prev = null
  const next = null
  const last = 1

  const result: PaginationResult<T> = {
    first,
    prev,
    next,
    last,
    pages,
    items: total,
    data,
  }

  cachedArray = array as unknown[]
  cachedStart = start
  cachedEnd = end
  cachedResult = result as PaginationResult<unknown>

  return result
}
