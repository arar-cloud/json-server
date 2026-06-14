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

function embed(db: Low<Data>, name: string, item: Item, related: string, depth: number = 0, visitedIds: Set<string | number> = new Set()): Item {
  // Prevent circular embedding and deep nesting
  const MAX_EMBED_DEPTH = 10
  if (depth > MAX_EMBED_DEPTH) {
    return item
  }

  // Check for self-reference or circular reference
  const itemId = item.id
  if ((typeof itemId === 'string' || typeof itemId === 'number') && visitedIds.has(itemId)) {
    return item // Already embedded this item, stop to prevent infinite loop
  }
  if (typeof itemId === 'string' || typeof itemId === 'number') {
    visitedIds = new Set(visitedIds)
    visitedIds.add(itemId)
  }

  if (inflection.singularize(related) === related) {
    const relatedData = db.data[inflection.pluralize(related)] as Item[]
    if (!relatedData) {
      return item
    }
    const foreignKey = `${related}Id`
    const relatedItem = relatedData.find((relatedItem: Item) => {
      const rid = relatedItem['id']
      return relatedItem && relatedItem['id'] === item[foreignKey] && (typeof rid !== 'string' && typeof rid !== 'number' || !visitedIds.has(rid))
    })
    return { ...item, [related]: relatedItem || undefined }
  }
  const relatedData: Item[] = db.data[related] as Item[]

  if (!relatedData) {
    return item
  }

  const foreignKey = `${inflection.singularize(name)}Id`
  const relatedItems = relatedData.filter((relatedItem: Item) => {
    const rid = relatedItem['id']
    return relatedItem && relatedItem[foreignKey] === item['id'] && (typeof rid !== 'string' && typeof rid !== 'number' || !visitedIds.has(rid))
  })

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
        if (item !== undefined) item = embed(this.#db, name, item, related, 0, new Set())
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

    results = results.filter((item) => matchesWhere(item as JsonObject, opts.where))
    if (opts.sort) {
      results = sortOn(results, opts.sort.split(','))
    }

    if (opts.page !== undefined) {
      return paginate(results, opts.page, opts.perPage ?? 10)
    }

    return results
  }

  async create(name: string, data: Omit<Item, 'id'> = {}): Promise<Item | undefined> {
    try {
      const items = this.#get(name)
      if (items === undefined || !Array.isArray(items)) return

      const item = { ...data, id: randomId() }
      const beforeLength = items.length
      items.push(item)

      try {
        await this.#db.write()
      } catch (writeError) {
        // Rollback on write failure
        if (items.length > beforeLength) {
          items.pop()
        }
        throw writeError
      }
      return item
    } catch (error) {
      console.error(`Failed to create item in ${name}:`, error)
      throw error
    }
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
    try {
      const items = this.#get(name)
      if (items === undefined || !Array.isArray(items)) return

      const item = items.find((item) => item['id'] === id)
      if (!item) return

      const nextItem = isPatch ? { ...item, ...body, id } : { ...body, id }
      const index = items.indexOf(item)
      const previousItem = items[index]
      items.splice(index, 1, nextItem)

      try {
        await this.#db.write()
      } catch (writeError) {
        // Rollback on write failure
        items.splice(index, 1, previousItem)
        throw writeError
      }
      return nextItem
    } catch (error) {
      console.error(`Failed to update item in ${name}:`, error)
      throw error
    }
  }

  async destroy(
    name: string,
    dependent?: string | string[],
  ): Promise<Item | undefined> {
    const item = this.#get(name)
    if (item === undefined || Array.isArray(item)) return

    const originalItem = item

    try {
      // Clear the item data
      this.#db.data[name] = {}

      await this.#db.write()
      return originalItem
    } catch (writeError) {
      // Rollback on write failure
      this.#db.data[name] = originalItem
      throw writeError
    }
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
    try {
      const items = this.#get(name)
      if (items === undefined || !Array.isArray(items)) return

      const item = items.find((item) => item['id'] === id)
      if (item === undefined) return
      const index = items.indexOf(item)
      const previousItem = items[index]
      items.splice(index, 1)

      try {
        nullifyForeignKey(this.#db, name, id)
        const dependents = ensureArray(dependent)
        deleteDependents(this.#db, name, dependents)

        await this.#db.write()
      } catch (writeError) {
        // Rollback on write failure
        items.splice(index, 0, previousItem)
        throw writeError
      }
      return item
    } catch (error) {
      console.error(`Failed to delete item in ${name}:`, error)
      throw error
    }
  }
}
