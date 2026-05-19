import inflection from 'inflection'
import { Low } from 'lowdb'
import sortOn from 'sort-on'
import type { JsonObject } from 'type-fest'

import { matchesWhere } from './matches-where.ts'
import { paginate, type PaginationResult } from './paginate.ts'
import { randomId } from './random-id.ts'

const QUERY_TIMEOUT_MS = 30000 // 30 second timeout

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`Operation timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ])
}

class TransactionLock {
  private locks = new Map<string, Promise<void>>()
  
  async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Wait for existing lock on this key
    if (this.locks.has(key)) {
      await this.locks.get(key)
    }
    
    let releaseLock: () => void = () => {}
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve
    })
    
    this.locks.set(key, lockPromise)
    
    try {
      return await fn()
    } finally {
      this.locks.delete(key)
      releaseLock()
    }
  }
}
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
  #txLock: TransactionLock

  constructor(db: Low<Data>) {
    this.#db = db
    this.#txLock = new TransactionLock()
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
    return this.#txLock.acquire(`create_${name}`, async () => {
      const items = this.#get(name)
      if (items === undefined || !Array.isArray(items)) return

      const item = { ...data, id: randomId() }
      items.push(item)

      await withTimeout(this.#db.write(), QUERY_TIMEOUT_MS)
      return item
    })
  }

  async #updateOrPatch(name: string, body: Item = {}, isPatch: boolean): Promise<Item | undefined> {
    const item = this.#get(name)
    if (item === undefined || Array.isArray(item)) return

    const nextItem = (this.#db.data[name] = isPatch ? { ...item, ...body } : body)

    await withTimeout(this.#db.write(), QUERY_TIMEOUT_MS)
    return nextItem
  }

  async #updateOrPatchById(
    name: string,
    id: string,
    body: Item = {},
    isPatch: boolean,
  ): Promise<Item | undefined> {
    return this.#txLock.acquire(`${isPatch ? 'patch' : 'update'}_${name}_${id}`, async () => {
      const items = this.#get(name)
      if (items === undefined || !Array.isArray(items)) return

      const item = items.find((item) => item['id'] === id)
      if (!item) return

      const nextItem = isPatch ? { ...item, ...body, id } : { ...body, id }
      const index = items.indexOf(item)
      items.splice(index, 1, nextItem)

      await withTimeout(this.#db.write(), QUERY_TIMEOUT_MS)
      return nextItem
    })
  }

  async update(name: string, body: Item = {}): Promise<Item | undefined> {
    return this.#txLock.acquire(`update_${name}`, async () => {
      return this.#updateOrPatch(name, body, false)
    })
  }

  async patch(name: string, body: Item = {}): Promise<Item | undefined> {
    return this.#txLock.acquire(`patch_${name}`, async () => {
      return this.#updateOrPatch(name, body, true)
    })
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
    return this.#txLock.acquire(`destroy_${name}_${id}`, async () => {
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
    })
  }
}
