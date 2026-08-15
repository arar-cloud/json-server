import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

const OPERATOR_PATTERN = /^(.*)_([a-z]+)$/

// Cache for parseWhere results to avoid redundant parsing of identical query strings
const PARSE_WHERE_CACHE = new Map<string, JsonObject>()
const MAX_CACHE_SIZE = 256

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
  const underscoreMatch = key.match(OPERATOR_PATTERN)
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

const valueCache = new Map<string, string | number | boolean | null>()

function coerceValue(value: string): string | number | boolean | null {
  if (valueCache.has(value)) {
    return valueCache.get(value)!
  }

  let result: string | number | boolean | null
  if (value === 'true') result = true
  else if (value === 'false') result = false
  else if (value === 'null') result = null
  else if (value.trim() === '') result = value
  else {
    const num = Number(value)
    result = Number.isFinite(num) ? num : value
  }

  valueCache.set(value, result)
  return result
}

export function parseWhere(query: string): JsonObject {
  // Return cached result if available
  if (PARSE_WHERE_CACHE.has(query)) {
    return PARSE_WHERE_CACHE.get(query)!
  }

  const out: JsonObject = {}
  const params = new URLSearchParams(query)
  valueCache.clear()

  for (const [rawKey, rawValue] of params.entries()) {
    const { path, op } = splitKey(rawKey)
    if (op === null) continue
    setPathOp(out, path, op, rawValue)
  }

  // Store in cache with simple size limit to prevent unbounded growth
  if (PARSE_WHERE_CACHE.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (first key)
    const firstKey = PARSE_WHERE_CACHE.keys().next().value
    if (firstKey) {
      PARSE_WHERE_CACHE.delete(firstKey)
    }
  }
  PARSE_WHERE_CACHE.set(query, out)

  return out
}
