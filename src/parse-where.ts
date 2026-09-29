import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

// Simple LRU cache for parsed where clauses to avoid repeated parsing
class LRUCache {
  private cache: Map<string, JsonObject> = new Map()
  private readonly maxSize = 100

  get(key: string): JsonObject | undefined {
    if (!this.cache.has(key)) return undefined
    // Move to end (most recently used)
    const value = this.cache.get(key)!
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key: string, value: JsonObject): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }
    this.cache.set(key, value)
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.cache.delete(firstKey!)
    }
  }
}

const whereCache = new LRUCache()

function splitKey(key: string): { path: string; op: WhereOperator | null } {
  const colonIdx = key.lastIndexOf(':')
  if (colonIdx !== -1) {
    const path = key.slice(0, colonIdx)
    const op = key.slice(colonIdx + 1)
    if (!op) {
      return { path: key, op: 'eq' }
    }

    return isWhereOperator(op) ? { path, op } : { path, op: null }
  }

  // Compatibility with v0.17 operator style (e.g. _lt, _gt)
  const underscoreMatch = key.match(/^(.*)_([a-z]+)$/)
  if (underscoreMatch) {
    const path = underscoreMatch[1]
    const op = underscoreMatch[2]
    if (path && isWhereOperator(op)) {
      return { path, op }
    }
  }

  return { path: key, op: 'eq' }
}

function setPathOp(root: JsonObject, path: string, op: WhereOperator, value: string): void {
  const fullPath = `${path}.${op}`
  if (op === 'in') {
    setProperty(
      root,
      fullPath,
      value.split(',').map((part) => coerceValue(part.trim())),
    )
    return
  }

  setProperty(root, fullPath, coerceValue(value))
}

function coerceValue(value: string): string | number | boolean | null {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null

  if (value.trim() === '') return value

  const num = Number(value)
  if (Number.isFinite(num)) return num

  return value
}

export function parseListParams(
  url: string,
  reserved: Set<string>,
): Record<string, unknown> {
  const query = new URLSearchParams(url.split('?')[1])
  const filterParams: Record<string, unknown> = {}
  let _where: string | null = null
  let hasWhere = false

  // Single-pass iteration: collect filter params and extract _where simultaneously
  for (const [key, value] of query) {
    if (key === '_where') {
      _where = value
      hasWhere = true
    } else if (!reserved.has(key)) {
      filterParams[key] = value
    }
  }

  return hasWhere && _where ? parseWhere(_where) : filterParams
}

export function parseWhere(query: string): JsonObject {
  // Check cache first to avoid repeated parsing of identical where clauses
  const cached = whereCache.get(query)
  if (cached !== undefined) {
    return cached
  }

  const out: JsonObject = {}
  const params = new URLSearchParams(query)

  for (const [rawKey, rawValue] of params.entries()) {
    const { path, op } = splitKey(rawKey)
    if (op === null) continue
    setPathOp(out, path, op, rawValue)
  }

  // Store parsed result in cache for future identical requests
  whereCache.set(query, out)
  return out
}
