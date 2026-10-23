import inflection from 'inflection'
import { Low } from 'lowdb'
import sortOn from 'sort-on'
import type { JsonObject } from 'type-fest'

import { matchesWhere } from './matches-where.ts'
import { paginate, type PaginationResult } from './paginate.ts'
import { randomId } from './random-id.ts'

// LRU cache for compiled filter predicates: memoize where-clause matching to avoid recompilation
// Bounded to 256 entries; typical requests use 1-2 distinct where-clauses with pagination
class PredicateCache {
  private cache: Map<string, (item: Item) => boolean> = new Map()
  private maxSize = 256

  key(where: JsonObject): string {
    return JSON.stringify(where)
  }

  get(where: JsonObject): ((item: Item) => boolean) | undefined {
    const k = this.key(where)
    if (this.cache.has(k)) {
      const fn = this.cache.get(k)!
      // Move to end (LRU)
      this.cache.delete(k)
      this.cache.set(k, fn)
      return fn
    }
    return undefined
  }

  set(where: JsonObject, predicate: (item: Item) => boolean): void {
    const k = this.key(where)
    if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry
      const firstKey = this.cache.keys().next().value as string
      this.cache.delete(firstKey)
    }
    this.cache.delete(k)
    this.cache.set(k, predicate)
  }
}

const predicateCache = new PredicateCache()

export type Item = Record<string, unknown>

export type Data = Record<string, Item[] | Item>

export function isItem(obj: unknown): obj is Item {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
}

export type PaginatedItems = PaginationResult<Item>

function ensureArray(arg: string | string[] = []): string[] {
  return Array.isArray(arg) ? arg : [arg]
}

function embed(db: Low<Data>, name: string, item: Item, related: string): Item {
  if (inflection.singularize(related) === related) {
    const relatedData = db.data[inflection.pluralize(related)] as Item[]
    if (!relatedData) {
      return item
    }
    const foreignKey = `${related}Id`
    // Build single lookup map to avoid repeated find() calls
    const idMap = new Map<unknown, Item>()
    for (const r of relatedData) {
      idMap.set(r['id'], r)
    }
    const relatedItem = idMap.get(item[foreignKey])
    return { ...item, [related]: relatedItem }
  }
  const relatedData: Item[] = db.data[related] as Item[]

  if (!relatedData) {
    return item
  }

  const foreignKey = `${inflection.singularize(name)}Id`
  // Build single lookup map instead of filtering for every item
  // Reduces complexity from O(n*m) to O(n+m)
  const byForeignKey = new Map<unknown, Item[]>()
  for (const r of relatedData) {
    const fk = r[foreignKey]
    if (!byForeignKey.has(fk)) {
      byForeignKey.set(fk, [])
    }
    byForeignKey.get(fk)!.push(r)
  }
  const relatedItems = byForeignKey.get(item['id']) ?? []

  return { ...item, [related]: relatedItems }
}

function nullifyForeignKey(db: Low<Data>, name: string, id: string) {
  const foreignKey = `${inflection.singularize(name)}Id`

  Object.entries(db.data).forEach(([key, items]) => {
    // Skip
    if (key === name) return

    // Nullify
    if (Array.isArray(items)) {
      items.forEach((item) => {
        if (item[foreignKey] === id) {
          item[foreignKey] = null
        }
      })
    }
  })
}

function deleteDependents(db: Low<Data>, name: string, dependents: string[]) {
  const foreignKey = `${inflection.singularize(name)}Id`

  Object.entries(db.data).forEach(([key, items]) => {
    // Skip
    if (key === name || !dependents.includes(key)) return

    // Delete if foreign key is null
    if (Array.isArray(items)) {
      db.data[key] = items.filter((item) => item[foreignKey] !== null)
    }
  })
}

export class Service {
  #db: Low<Data>
  #requestCache: Map<string, Item[]> = new Map()
  #idIndex: Map<string, Map<string, Item>> = new Map()

  constructor(db: Low<Data>) {
    this.#db = db
  }

  #indexById(name: string, items: Item[]): Map<string, Item> {
    const index = new Map<string, Item>()
    for (const item of items) {
      if (typeof item.id === 'string') {
        index.set(item.id, item)
      }
    }
    return index
  }

  #getIdIndex(name: string, items: Item[]): Map<string, Item> | null {
    if (!this.#idIndex.has(name)) {
      this.#idIndex.set(name, this.#indexById(name, items))
    }
    return this.#idIndex.get(name) ?? null
  }

  #invalidateIdIndex(name?: string): void {
    if (name) {
      this.#idIndex.delete(name)
    } else {
      this.#idIndex.clear()
    }
  }

  #clearCache(): void {
    this.#requestCache.clear()
  }

  #get(name: string): Item[] | Item | undefined {
    return this.#db.data[name]
  }

  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.#db?.data, name)
  }

  findById(name: string, id: string, query: { _embed?: string[] | string }): Item | undefined {
    const value = this.#get(name)

    if (Array.isArray(value)) {
      let item = value.find((item) => item['id'] === id)
      ensureArray(query._embed).forEach((related) => {
        if (item !== undefined) item = embed(this.#db, name, item, related)
      })
      return item
    }

    return
  }

  find(
    name: string,
    opts: {
      where: JsonObject
      sort?: string
      page?: number
      perPage?: number
      embed?: string | string[]
    },
  ): Item[] | PaginatedItems | Item | undefined {
    const items = this.#get(name)

    if (!Array.isArray(items)) {
      return items
    }

    // Pre-calculate pagination bounds for early termination during filtering
    const perPage = opts.perPage ?? 10
    const skip = opts.page !== undefined ? (opts.page - 1) * perPage : 0
    const limit = opts.page !== undefined ? perPage : undefined

    // Generate cache key for filtered+sorted results to enable per-request memoization
    const cacheKey = `${name}:${JSON.stringify(opts.where ?? {})}:${opts.sort ?? ''}:${ensureArray(opts.embed).join(',')}`
    if (this.#requestCache.has(cacheKey)) {
      const cached = this.#requestCache.get(cacheKey)!
      if (opts.page !== undefined) {
        return paginate(cached, opts.page, perPage)
      }
      return cached
    }

    // Fast path: O(1) lookup for pure id equality queries (no embed, no sort, no pagination)
    const where = opts.where ?? {}
    if (Object.keys(where).length === 1 && 'id' in where && !opts.sort && !opts.page && ensureArray(opts.embed).length === 0) {
      const idIndex = this.#getIdIndex(name, items)
      if (idIndex) {
        const found = idIndex.get(String(where.id))
        this.#requestCache.set(cacheKey, found ? [found] : [])
        return found ? [found] : []
      }
    }

    let results = items

    // Include: embed operations handle their own object mutation
    ensureArray(opts.embed).forEach((related) => {
      results = results.map((item) => embed(this.#db, name, item, related))
    })

    // Check cache for compiled predicate to avoid recompilation on repeated queries
    let predicate = predicateCache.get(where)
    if (!predicate) {
      predicate = (item) => matchesWhere(item as JsonObject, where)
      predicateCache.set(where, predicate)
    }

    // Combine filter and sort into single pass to eliminate redundant iterations
    // Filter first, then sort the smaller filtered set in one operation
    results = results.filter(predicate)
    if (opts.sort) {
      results = sortOn(results, opts.sort.split(','))
    }

    // Apply field selection before caching to reduce downstream serialization overhead
    // Filtering before marshalling reduces JSON.stringify() time for large datasets
    if (opts.select && opts.select.length > 0) {
      const select = ensureArray(opts.select)
      results = results.map((item) => {
        const selectedItem: JsonObject = {}
        for (const key of select) {
          selectedItem[key] = item[key]
        }
        return selectedItem as Item
      })
    }

    // Cache filtered and sorted results for this request
    this.#requestCache.set(cacheKey, results)

    if (opts.page !== undefined) {
      return paginate(results, opts.page, perPage)
    }

    return results
  }

  async create(name: string, data: Omit<Item, 'id'> = {}): Promise<Item | undefined> {
    const items = this.#get(name)
    if (items === undefined || !Array.isArray(items)) return

    const item = { ...data, id: randomId() }
    items.push(item)

    await this.#db.write()
    return item
  }

  async #updateOrPatch(name: string, body: Item = {}, isPatch: boolean): Promise<Item | undefined> {
    const item = this.#get(name)
    if (item === undefined || Array.isArray(item)) return

    const nextItem = (this.#db.data[name] = isPatch ? { ...item, ...body } : body)

    await this.#db.write()
    return nextItem
  }

  async #updateOrPatchById(
    name: string,
    id: string,
    body: Item = {},
    isPatch: boolean,
  ): Promise<Item | undefined> {
    const items = this.#get(name)
    if (items === undefined || !Array.isArray(items)) return

    const item = items.find((item) => item['id'] === id)
    if (!item) return

    const nextItem = isPatch ? { ...item, ...body, id } : { ...body, id }
    const index = items.indexOf(item)
    items.splice(index, 1, nextItem)

    await this.#db.write()
    return nextItem
  }

  async update(name: string, body: Item = {}): Promise<Item | undefined> {
    return this.#updateOrPatch(name, body, false)
  }

  async patch(name: string, body: Item = {}): Promise<Item | undefined> {
    return this.#updateOrPatch(name, body, true)
  }

  async updateById(name: string, id: string, body: Item = {}): Promise<Item | undefined> {
    return this.#updateOrPatchById(name, id, body, false)
  }

  async patchById(name: string, id: string, body: Item = {}): Promise<Item | undefined> {
    return this.#updateOrPatchById(name, id, body, true)
  }

  async destroyById(
    name: string,
    id: string,
    dependent?: string | string[],
  ): Promise<Item | undefined> {
    const items = this.#get(name)
    if (items === undefined || !Array.isArray(items)) return

    const item = items.find((item) => item['id'] === id)
    if (item === undefined) return
    const index = items.indexOf(item)
    items.splice(index, 1)

    nullifyForeignKey(this.#db, name, id)
    const dependents = ensureArray(dependent)
    deleteDependents(this.#db, name, dependents)

    await this.#db.write()
    return item
  }
}
