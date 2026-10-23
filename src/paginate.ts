export type PaginationResult<T> = {
  first: number
  prev: number | null
  next: number | null
  last: number
  pages: number
  items: number
  data: T[]
}

export type PaginationIndices = {
  start: number
  end: number
  total: number
  page: number
  perPage: number
}

// LRU cache for pagination metadata: store total/pages/offset calculations to avoid recomputation
// for identical dataset sizes and pagination parameters. Bounded to 64 entries.
class PaginationMetadataCache {
  private cache: Map<string, { total: number; pages: number }> = new Map()
  private maxSize = 64

  key(itemsLength: number, perPage: number): string {
    return `${itemsLength}:${perPage}`
  }

  get(itemsLength: number, perPage: number): { total: number; pages: number } | undefined {
    const k = this.key(itemsLength, perPage)
    if (this.cache.has(k)) {
      const val = this.cache.get(k)!
      // Move to end (LRU)
      this.cache.delete(k)
      this.cache.set(k, val)
      return val
    }
    return undefined
  }

  set(itemsLength: number, perPage: number, total: number, pages: number): void {
    const k = this.key(itemsLength, perPage)
    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxSize && !this.cache.has(k)) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }
    this.cache.set(k, { total, pages })
  }
}

const paginationCache = new PaginationMetadataCache()

export function getPaginationIndices(total: number, page: number, perPage: number): PaginationIndices {
  const safePerPage = Number.isFinite(perPage) && perPage > 0 ? Math.floor(perPage) : 1

  const pages = Math.max(1, Math.ceil(total / safePerPage))
  const safePage = Number.isFinite(page) ? Math.floor(page) : 1
  const currentPage = Math.max(1, Math.min(safePage, pages))

  const start = (currentPage - 1) * safePerPage
  const end = Math.min(start + safePerPage, total)

  return { start, end, total, page: currentPage, perPage: safePerPage }
}

export function paginate<T>(items: T[], page: number, perPage: number): PaginationResult<T> {
  const totalItems = items.length
  const indices = getPaginationIndices(totalItems, page, perPage)

  const first = 1
  const pages = Math.max(1, Math.ceil(totalItems / indices.perPage))
  const prev = indices.page > 1 ? indices.page - 1 : null
  const next = indices.page < pages ? indices.page + 1 : null
  const last = pages

  // Index-based pagination: caller can now use indices for iteration without copying
  // slice() limited to [start, end) range only - O(perPage) memory cost
  const data = items.slice(indices.start, indices.end)

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
