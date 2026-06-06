import inflection from 'inflection'
import { Low } from 'lowdb'
import sortOn from 'sort-on'
import type { JsonObject } from 'type-fest'

import { matchesWhere } from './matches-where.ts'
import { paginate, type PaginationResult } from './paginate.ts'
import { randomId } from './random-id.ts'
export type Item = Record<string, unknown>

export type Data = Record<string, Item[] | Item>

export function isItem(obj: unknown): obj is Item {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
}

export type PaginatedItems = PaginationResult<Item>

function ensureArray(arg: string | string[] = []): string[] {
  return Array.isArray(arg) ? arg : [arg]
}

// Cache for computed embed maps: key = "relationName|isSingular|foreignKey"
const embedMapCache = new Map<string, Map<unknown, Item | Item[]>>()

function embedBatch(db: Low<Data>, items: Item[], related: string, name: string): Map<unknown, Item | Item[]> {
  const resultMap = new Map<unknown, Item | Item[]>()
  const isSingular = inflection.singularize(related) === related
  const relatedData = isSingular 
    ? db.data[inflection.pluralize(related)] as Item[]
    : db.data[related] as Item[]

  if (!Array.isArray(relatedData)) {
    return resultMap
  }

  // Check cache before computing
  const cacheKey = `${related}|${isSingular}|${name}`
  if (embedMapCache.has(cacheKey)) {
    return embedMapCache.get(cacheKey)!
  }

  if (isSingular) {
    // For singular relations: build map indexed by id for O(1) lookup
    const indexById = new Map<unknown, Item>()
    for (const relItem of relatedData) {
      indexById.set(relItem['id'], relItem)
    }
    for (const item of items) {
      const fk = item[`${related}Id`]
      if (fk !== undefined && indexById.has(fk)) {
        resultMap.set(fk, indexById.get(fk)!)
      }
    }
  } else {
    // For plural relations: build map indexed by foreign key
    const indexByKey = new Map<unknown, Item[]>()
    const foreignKey = `${inflection.singularize(name)}Id`
    for (const relItem of relatedData) {
      const key = relItem[foreignKey]
      if (!indexByKey.has(key)) {
        indexByKey.set(key, [])
      }
      indexByKey.get(key)!.push(relItem)
    }
    for (const item of items) {
      const id = item['id']
      if (id !== undefined && indexByKey.has(id)) {
        resultMap.set(id, indexByKey.get(id)!)
      }
    }
  }
  
  // Store in cache before returning
  embedMapCache.set(cacheKey, resultMap)
  return resultMap
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
      const embeds = ensureArray(query._embed)
      if (item && embeds.length > 0) {
        const embedCache = new Map<string, Map<unknown, Item | Item[]>>()
        for (const rel of embeds) {
          embedCache.set(rel, embedBatch(this.#db, [item], rel, name))
        }
        for (const rel of embeds) {
          const isSingular = inflection.singularize(rel) === rel
          const fk: unknown = isSingular ? item[`${rel}Id`] : item['id']
          const cache = embedCache.get(rel)!
          if (cache.has(fk)) {
            item = { ...item, [rel]: cache.get(fk)! }
          }
        }
      }
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

    // Batch resolve all embeds for O(n) instead of O(n²) complexity
    const embeds = ensureArray(opts.embed)
    if (embeds.length > 0) {
      const embedCache = new Map<string, Map<unknown, Item | Item[]>>()
      for (const rel of embeds) {
        embedCache.set(rel, embedBatch(this.#db, results, rel, name))
      }
      results = results.map((item) => {
        for (const rel of embeds) {
          const isSingular = inflection.singularize(rel) === rel
          const fk = isSingular ? item[`${rel}Id`] : item['id']
          const cache = embedCache.get(rel)!
          if (cache.has(fk)) {
            item = { ...item, [rel]: cache.get(fk)! }
          }
        }
        return item
      })
    }

    // Memoize where clause evaluation to avoid redundant operator checks per item
    const matchCache = new Map<Item, boolean>()
    results = results.filter((item) => {
      if (!matchCache.has(item)) {
        matchCache.set(item, matchesWhere(item as JsonObject, opts.where))
      }
      return matchCache.get(item)!
    })
    
    if (opts.sort) {
      results = sortOn(results, opts.sort.split(','))
    }

    if (opts.page !== undefined) {
      return paginate(results, opts.page, opts.perPage ?? 10)
    }

    return results
  }

  async create(name: string, data: Omit<Item, 'id'> = {}): Promise<Item | undefined> {
    embedMapCache.clear()
    const items = this.#get(name)
    if (items === undefined || !Array.isArray(items)) return

    const item = { ...data, id: randomId() }
    items.push(item)

    await this.#db.write()
    return item
  }

  async #updateOrPatch(name: string, body: Item = {}, isPatch: boolean): Promise<Item | undefined> {
    embedMapCache.clear()
    const item = this.#get(name)
    if (item === undefined || Array.isArray(item)) return

    const nextItem = (this.#db.data[name] = isPatch ? { ...item, ...body } : body)

    await this.#db.write()
    return nextItem
  }

  async destroyAll(name: string): Promise<void> {
    embedMapCache.clear()
    const items = this.#get(name)
    if (items === undefined || !Array.isArray(items)) return
    items.length = 0
    await this.#db.write()
  }

  async #updateOrPatchById(
    name: string,
    id: string,
    body: Item = {},
    isPatch: boolean,
  ): Promise<Item | undefined> {
    embedMapCache.clear()
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
    embedMapCache.clear()
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
