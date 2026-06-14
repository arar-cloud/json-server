import inflection from 'inflection'
import { Low } from 'lowdb'
import sortOn from 'sort-on'
import type { JsonObject } from 'type-fest'

import { matchesWhere } from './matches-where.ts'
import { paginate, type PaginationResult } from './paginate.ts'
import { randomId } from './random-id.ts'

// Audit logging for database modifications
function auditLog(operation: string, resource: string, id?: string, details?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString()
  const logMessage = {
    timestamp,
    operation,
    resource,
    id: id || 'N/A',
    details: details ? JSON.stringify(details).slice(0, 500) : undefined,
  }
  console.log('[audit]', JSON.stringify(logMessage))
}

export type Item = Record<string, unknown>

export type Data = Record<string, Item[] | Item>

export function isItem(obj: unknown): obj is Item {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
}

// Sanitize item to prevent injection of unexpected properties and prototype pollution
function sanitizeItem(item: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  const MAX_PROPERTY_COUNT = 100
  const MAX_PROPERTY_NAME_LENGTH = 255
  const FORBIDDEN_KEYS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    'eval',
    'exec',
    'Function',
  ])
  
  let propertyCount = 0
  
  for (const [key, value] of Object.entries(item)) {
    // Check property count limit
    if (propertyCount >= MAX_PROPERTY_COUNT) {
      console.warn('[security] Rejected item with too many properties')
      break
    }
    
    // Validate key format and reject forbidden keys
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_PROPERTY_NAME_LENGTH) {
      console.warn('[security] Rejected invalid or excessively long property key')
      continue
    }
    
    if (FORBIDDEN_KEYS.has(key) || key.startsWith('_')) {
      console.warn('[security] Rejected forbidden key:', key)
      continue
    }
    
    // Allow primitives, arrays, and plain objects; reject functions and symbols
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      sanitized[key] = value
    } else if (Array.isArray(value)) {
      sanitized[key] = value
    } else if (typeof value === 'object' && value?.constructor === Object) {
      sanitized[key] = value
    }
    
    propertyCount++
  }
  
  return sanitized
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
    const items = this.#get(name)
    if (items === undefined || !Array.isArray(items)) return

    const sanitized = sanitizeItem(data)
    const item = { ...sanitized, id: randomId() }
    items.push(item)

    await this.#db.write()
    auditLog('CREATE', name, item.id as string, { keys: Object.keys(item) })
    return item
  }

  async #updateOrPatch(name: string, body: Item = {}, isPatch: boolean): Promise<Item | undefined> {
    const item = this.#get(name)
    if (item === undefined || Array.isArray(item)) return

    const sanitized = sanitizeItem(body)
    const nextItem = (this.#db.data[name] = isPatch ? { ...item, ...sanitized } : sanitized)

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

    const sanitized = sanitizeItem(body)
    const nextItem = isPatch ? { ...item, ...sanitized, id } : { ...sanitized, id }
    const index = items.indexOf(item)
    items.splice(index, 1, nextItem)

    await this.#db.write()
    auditLog(isPatch ? 'PATCH' : 'UPDATE', name, id, { keys: Object.keys(body) })
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
    auditLog('DELETE', name, id)
    return item
  }
}
