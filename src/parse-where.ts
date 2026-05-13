import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

// LRU cache for parsed WHERE clauses to eliminate redundant AST construction
class ParseWhereCache {
  private cache: Map<string, JsonObject> = new Map()
  private maxSize: number = 256

  get(key: string): JsonObject | undefined {
    if (this.cache.has(key)) {
      const val = this.cache.get(key)!
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, val)
      return val
    }
    return undefined
  }

  set(key: string, value: JsonObject): void {
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

const parseWhereCache = new ParseWhereCache()

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

// ReDoS protection: max input length to prevent regex catastrophic backtracking
const MAX_WHERE_KEY_LENGTH = 500
const MAX_QUERY_LENGTH = 2048

// DoS protection: query complexity limits
const MAX_QUERY_DEPTH = 10
const MAX_KEYS_PER_LEVEL = 50

// Pre-compiled operator validation pattern (avoid regex recompilation on each check)
const OPERATOR_PATTERN = /^[a-z]+$/

// Pre-compiled Set for O(1) operator lookup instead of repeated regex matching
const KNOWN_OPERATORS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in'])

function splitKey(key: string): { path: string; op: WhereOperator | null } {
  // Validate input length to prevent ReDoS attacks
  if (key.length > MAX_WHERE_KEY_LENGTH) {
    return { path: key, op: null }
  }
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
  // Regex is safe with length validation above; pattern is simple and bounded
  const underscoreMatch = key.match(/^(.*)_([a-z]+)$/)
  if (underscoreMatch) {
    const path = underscoreMatch[1]
    const op = underscoreMatch[2]
    // Use pre-compiled Set for O(1) operator validation before isWhereOperator call
    if (path && OPERATOR_PATTERN.test(op) && KNOWN_OPERATORS.has(op)) {
      if (isWhereOperator(op)) {
        return { path, op }
      }
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

export function parseWhere(query: string): JsonObject {
  // Validate query length to prevent ReDoS attacks
  if (query.length > MAX_QUERY_LENGTH) {
    console.warn(`Query exceeds max length of ${MAX_QUERY_LENGTH}, rejecting`)
    return {}
  }

  // Check cache first to avoid re-parsing identical query strings
  const cachedResult = parseWhereCache.get(query)
  if (cachedResult !== undefined) {
    return cachedResult
  }

  const out: JsonObject = {}
  const params = new URLSearchParams(query)

  // Validate total parameter count at top level
  let paramCount = 0
  for (const [rawKey] of params.entries()) {
    paramCount++
    if (paramCount > MAX_KEYS_PER_LEVEL) {
      return { __error: 'Query exceeds maximum parameter limit' }
    }
    // Validate nesting depth in key path
    const depth = (rawKey.match(/\./g) || []).length
    if (depth > MAX_QUERY_DEPTH) {
      return { __error: 'Query key path exceeds maximum nesting depth' }
    }
  }

  for (const [rawKey, rawValue] of params.entries()) {
    const { path, op } = splitKey(rawKey)
    if (op === null) continue
    setPathOp(out, path, op, rawValue)
  }

  // Cache the parsed result for future identical queries
  parseWhereCache.set(query, out)
  return out
}
