import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

// Security constants to prevent DoS attacks
const MAX_FILTER_DEPTH = 10
const MAX_EXPRESSION_SIZE = 10000 // characters
const MAX_FIELD_NAME_LENGTH = 256
const MAX_FILTER_PARAMS = 100

function splitKey(key: string): { path: string; op: WhereOperator | null } {
  // Validate key length to prevent expression size attacks
  if (key.length > MAX_FIELD_NAME_LENGTH) {
    throw new Error(`Field name exceeds maximum length of ${MAX_FIELD_NAME_LENGTH}`)
  }
  
  const colonIdx = key.lastIndexOf(':')
  if (colonIdx !== -1) {
    const path = key.slice(0, colonIdx)
    const op = key.slice(colonIdx + 1)
    if (!op) {
      return { path: key, op: 'eq' }
    }

    // Strict operator validation: reject if not in allowlist
    if (!isWhereOperator(op)) {
      throw new Error(`Invalid operator: ${op}`)
    }
    return { path, op }
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

export function parseWhere(query: string, depth: number = 0): JsonObject {
  // Validate input size to prevent memory exhaustion
  if (query.length > MAX_EXPRESSION_SIZE) {
    throw new Error(`Filter expression exceeds maximum size of ${MAX_EXPRESSION_SIZE} characters`)
  }

  // Enforce recursion depth limit
  if (depth > MAX_FILTER_DEPTH) {
    throw new Error(`Filter nesting depth exceeds maximum of ${MAX_FILTER_DEPTH}`)
  }

  const out: JsonObject = {}
  const params = new URLSearchParams(query)

  // Limit number of filter parameters
  const paramCount = Array.from(params.keys()).length
  if (paramCount > MAX_FILTER_PARAMS) {
    throw new Error(`Number of filter parameters exceeds maximum of ${MAX_FILTER_PARAMS}`)
  }

  for (const [rawKey, rawValue] of params.entries()) {
    const { path, op } = splitKey(rawKey)
    if (op === null) continue
    setPathOp(out, path, op, rawValue)
  }

  return out
}
