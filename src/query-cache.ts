import type { Item } from './service.ts'

interface CacheEntry {
  key: string
  value: Item[] | { data: Item[]; total: number; page: number; perPage: number }
  timestamp: number
}

/**
 * Simple LRU cache for query results.
 * Keyed on (where, sort, page, perPage) to avoid redundant filtering/sorting.
 * Bounded to 100 entries with automatic eviction of least-recently-used.
 */
export class QueryCache {
  private cache: Map<string, CacheEntry> = new Map()
  private maxSize: number = 100
  private hitCount: number = 0
  private missCount: number = 0

  /**
   * Generate cache key from query parameters
   */
  private generateKey(
    where: string,
    sort: string | undefined,
    page: number | undefined,
    perPage: number | undefined,
  ): string {
    return `${where}|${sort || ''}|${page || ''}|${perPage || ''}`
  }

  /**
   * Get cached result if exists and fresh (within 5 seconds)
   */
  get(
    where: string,
    sort: string | undefined,
    page: number | undefined,
    perPage: number | undefined,
  ): Item[] | { data: Item[]; total: number; page: number; perPage: number } | null {
    const key = this.generateKey(where, sort, page, perPage)
    const entry = this.cache.get(key)

    if (!entry) {
      this.missCount++
      return null
    }

    // Check if cache is fresh (within 5 seconds)
    const now = Date.now()
    if (now - entry.timestamp > 5000) {
      this.cache.delete(key)
      this.missCount++
      return null
    }

    // Move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, entry)
    this.hitCount++

    return entry.value
  }

  /**
   * Store query result in cache
   */
  set(
    where: string,
    sort: string | undefined,
    page: number | undefined,
    perPage: number | undefined,
    value: Item[] | { data: Item[]; total: number; page: number; perPage: number },
  ): void {
    const key = this.generateKey(where, sort, page, perPage)

    // Evict LRU entry if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    this.cache.set(key, {
      key,
      value,
      timestamp: Date.now(),
    })
  }

  /**
   * Clear entire cache (call on data mutations)
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  stats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.hitCount + this.missCount
    return {
      hits: this.hitCount,
      misses: this.missCount,
      size: this.cache.size,
      hitRate: total > 0 ? (this.hitCount / total) * 100 : 0,
    }
  }
}

export const queryCache = new QueryCache()
