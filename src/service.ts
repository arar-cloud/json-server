import inflection from 'inflection'
import { Low } from 'lowdb'
import sortOn from 'sort-on'
import type { JsonObject } from 'type-fest'

import { matchesWhere } from './matches-where.ts'
import { paginate, type PaginationResult } from './paginate.ts'
import { randomId } from './random-id.ts'

// Memoization cache for sort function factories to reduce recomputation
const sortFunctionCache = new Map<string, (items: unknown[]) => unknown[]>()

// Cache for parsed _where clauses to avoid re-parsing identical queries
const whereClauseCache = new Map<string, Record<string, unknown>>()

export type Item = Record<string, unknown>

export type Data = Record<string, Item[] | Item>

export function isItem(obj: unknown): obj is Item {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
}

export type PaginatedItems = PaginationResult<Item>

function ensureArray(arg: string | string[] = []): string[] {
  return Array.isArray(arg) ? arg : [arg]
}

export function parseListParams(
  query: URLSearchParams
): { where: Record<string, unknown>; params: Record<string, unknown> } {
  // Single-pass iteration instead of double-parsing to avoid redundant allocations
  const where: Record<string, unknown> = {}
  const params: Record<string, unknown> = {}
  const reserved = new Set(['_sort', '_order', '_page', '_limit', '_embed', '_where'])
  let rawWhere: string | null = null

  for (const [key, value] of query.entries()) {
    if (reserved.has(key)) {
      if (key === '_where') {
        rawWhere = value
      } else {
        params[key] = value
      }
    } else {
      where[key] = value
    }
  }

  // Cache and parse _where clause if provided
  if (rawWhere !== null) {
    let parsedWhere: Record<string, unknown>
    if (whereClauseCache.has(rawWhere)) {
      parsedWhere = whereClauseCache.get(rawWhere)!
    } else {
      try {
        const parsed = JSON.parse(rawWhere)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          parsedWhere = parsed as Record<string, unknown>
          whereClauseCache.set(rawWhere, parsedWhere)
        }
      } catch {
        // Invalid JSON, use empty where
        parsedWhere = {}
      }
    }
    Object.assign(where, parsedWhere)
  }

  return { where, params }
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

    // Apply filters and early termination for paginated queries
    results = results.filter((item) => matchesWhere(item as JsonObject, opts.where))
    
    if (opts.sort) {
      // Use memoized sort function to avoid recomputation for repeated sort keys
      const sortFn = getSortFunction(opts.sort)
      results = sortFn(results) as Item[]
    }

    // For paginated queries, slice early to avoid processing beyond page boundary
    if (opts.page !== undefined) {
      const perPage = opts.perPage ?? 10
      // Early termination: only keep what pagination needs plus margin for offset
      const maxNeeded = opts.page * perPage
      if (results.length > maxNeeded) {
        results = results.slice(0, maxNeeded)
      }
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
