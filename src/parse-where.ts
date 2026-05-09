import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

const MAX_PARSE_DEPTH = 50
const MAX_VALUE_LENGTH = 1e6

function splitKey(key: string): { path: string; op: WhereOperator | null } {
  if (key.length > MAX_VALUE_LENGTH) {
    throw new Error(`Key exceeds maximum length of ${MAX_VALUE_LENGTH}`)
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

export function parseWhere(query: string): JsonObject {
  const out: JsonObject = {}
  const params = new URLSearchParams(query)
  let depth = 0

  for (const [rawKey, rawValue] of params.entries()) {
    depth++
    if (depth > MAX_PARSE_DEPTH) {
      throw new Error(`Parse depth exceeds maximum of ${MAX_PARSE_DEPTH}`)
    }
    const { path, op } = splitKey(rawKey)
    if (op === null) continue
    if (rawValue.length > MAX_VALUE_LENGTH) {
      throw new Error(`Value for key '${rawKey}' exceeds maximum length of ${MAX_VALUE_LENGTH}`)
    }
    setPathOp(out, path, op, rawValue)
  }

  return out
}
