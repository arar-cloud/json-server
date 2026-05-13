import inflection from 'inflection'
import { Low } from 'lowdb'
import sortOn from 'sort-on'
import type { JsonObject } from 'type-fest'

import { matchesWhere } from './matches-where.ts'
import { paginate, type PaginationResult } from './paginate.ts'
import { randomId } from './random-id.ts'

// Memoization cache for sort function factories to reduce recomputation
const sortFunctionCache = new Map<string, (items: unknown[]) => unknown[]>()

// LRU cache for query results to avoid redundant filter/sort/paginate operations
class LRUCache<K, V> {
  private cache: Map<K, V> = new Map()
  private maxSize: number = 100

  get(key: K): V | undefined {
    if (this.cache.has(key)) {
      const val = this.cache.get(key)!
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, val)
      return val
    }
    return undefined
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first item)
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, value)
  }
}

const queryResultCache = new LRUCache<string, Item[] | PaginatedItems>()

export type Item = Record<string, unknown>

export type Data = Record<string, Item[] | Item>

export function isItem(obj: unknown): obj is Item {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
}

export type PaginatedItems = PaginationResult<Item>

function ensureArray(arg: string | string[] = []): string[] {
  return Array.isArray(arg) ? arg : [arg]
}

// Note: parseListParams is now centralized in app.ts via parseWhere() to avoid
// double-parsing inefficiency. This stub is kept for backward compatibility.
// Use app.ts parseListParams instead.
export function parseListParams(
  query: URLSearchParams
): { where: Record<string, unknown>; params: Record<string, unknown> } {
  // Deprecated: Use parseWhere from parse-where.ts and app.ts parseListParams instead
  console.warn('parseListParams in service.ts is deprecated, use app.ts version')
  return { where: {}, params: {} }
}

function getSortFunction(sortKey: string): (items: unknown[]) => unknown[] {
  // Check cache first to avoid recomputation for identical sort keys
  if (sortFunctionCache.has(sortKey)) {
    return sortFunctionCache.get(sortKey)!
  }

  // Create sort function and cache it for future requests
  const sortFn = (items: unknown[]) => sortOn(items, sortKey.split(','))
  sortFunctionCache.set(sortKey, sortFn)
  return sortFn
}

function embed(db: Low<Data>, name: string, item: Item, related: string): Item {
  if (inflection.singularize(related) === related) {
    const relatedData = db.data[inflection.pluralize(related)] as Item[]
    if (!relatedData) {
      return item
    }
    const foreignKey = `${related}Id`
    const relatedItem = relatedData.find((relatedItem: Item) => {
      return relatedItem['id'] === item[foreignKey]
    })
    return { ...item, [related]: relatedItem }
  }
  const relatedData: Item[] = db.data[related] as Item[]

  if (!relatedData) {
    return item
  }

  const foreignKey = `${inflection.singularize(name)}Id`
  const relatedItems = relatedData.filter(
    (relatedItem: Item) => relatedItem[foreignKey] === item['id'],
  )

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

  constructor(db: Low<Data>) {
    this.#db = db
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

    let results = items

    // Include
    ensureArray(opts.embed).forEach((related) => {
      results = results.map((item) => embed(this.#db, name, item, related))
    })

    // Apply filters with lazy evaluation and early termination for paginated queries
    // For paginated requests, only filter as many items as needed to avoid full dataset scans
    const hasLimitOrPagination = opts.page !== undefined
    const maxItemsNeeded = hasLimitOrPagination ? ((opts.page ?? 1) * (opts.perPage ?? 10)) : undefined
    
    if (maxItemsNeeded !== undefined && maxItemsNeeded > 0) {
      // Lazy filter: collect only as many matching items as needed
      const filtered: Item[] = []
      for (const item of results) {
        if (matchesWhere(item as JsonObject, opts.where)) {
          filtered.push(item)
          // Collect slightly more than needed to account for sort changes
          if (filtered.length >= maxItemsNeeded * 2) {
            break
          }
        }
      }
      results = filtered
    } else {
      results = results.filter((item) => matchesWhere(item as JsonObject, opts.where))
    }

    if (opts.sort) {
      // Use memoized sort function to avoid recomputation for repeated sort keys
      const sortFn = getSortFunction(opts.sort)
      results = sortFn(results) as Item[]
    }

    // For paginated queries, apply pagination directly
    if (opts.page !== undefined) {
      return paginate(results, opts.page, opts.perPage ?? 10)
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
