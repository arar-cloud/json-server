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

// Validate resource name to prevent path traversal and injection attacks
function validateResourceName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) {
    return false
  }
  // Reject path traversal sequences, special characters, and suspicious patterns
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return false
  }
  if (name.startsWith('.') || name.startsWith('_')) {
    return false
  }
  // Only allow alphanumeric, underscore, and hyphen
  return /^[a-zA-Z0-9_-]+$/.test(name)
}

// Validate resource ID to prevent injection attacks
function validateResourceId(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0 || id.length > 255) {
    return false
  }
  // Reject path traversal and special characters
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    return false
  }
  // Allow alphanumeric, hyphen, underscore
  return /^[a-zA-Z0-9_-]+$/.test(id)
}

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
    if (!validateResourceName(name) || !validateResourceId(id)) {
      console.warn('[security] Invalid resource name or ID:', name, id)
      auditLog('findById_blocked', name, id, { reason: 'invalid_identifier' })
      return undefined
    }
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
    if (!validateResourceName(name)) {
      console.warn('[security] Invalid resource name:', name)
      auditLog('find_blocked', name, undefined, { reason: 'invalid_resource_name' })
      return []
    }
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
    if (!validateResourceName(name)) {
      console.warn('[security] Invalid resource name for create:', name)
      auditLog('create_blocked', name, undefined, { reason: 'invalid_resource_name' })
      throw new Error('Invalid resource name')
    }
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
    if (!validateResourceName(name) || !validateResourceId(id)) {
      console.warn('[security] Invalid resource name or ID for update:', name, id)
      auditLog('updateById_blocked', name, id, { reason: 'invalid_identifier' })
      throw new Error('Invalid resource identifier')
    }
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
    if (!validateResourceName(name) || !validateResourceId(id)) {
      console.warn('[security] Invalid resource name or ID for destroy:', name, id)
      auditLog('destroyById_blocked', name, id, { reason: 'invalid_identifier' })
      throw new Error('Invalid resource identifier')
    }
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
