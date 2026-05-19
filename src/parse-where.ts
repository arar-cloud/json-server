import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

const MAX_WHERE_PAYLOAD_SIZE = 16384 // 16KB
const MAX_EXPRESSION_DEPTH = 10

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

function validateExpressionDepth(obj: unknown, depth = 0): boolean {
  if (depth > MAX_EXPRESSION_DEPTH) {
    return false
  }
  if (typeof obj !== 'object' || obj === null) {
    return true
  }
  if (Array.isArray(obj)) {
    return obj.every(item => validateExpressionDepth(item, depth + 1))
  }
  return Object.values(obj).every(val => validateExpressionDepth(val, depth + 1))
}

export function parseWhere(query: string): JsonObject {
  // Check payload size before processing
  if (query.length > MAX_WHERE_PAYLOAD_SIZE) {
    console.warn('Where clause exceeds maximum payload size')
    return {}
  }

  const out: JsonObject = {}
  const params = new URLSearchParams(query)

  for (const [rawKey, rawValue] of params.entries()) {
    const { path, op } = splitKey(rawKey)
    if (op === null) continue
    setPathOp(out, path, op, rawValue)
  }

  // Validate expression depth to prevent stack overflow
  if (!validateExpressionDepth(out)) {
    console.warn('Where clause expression exceeds maximum depth')
    return {}
  }

  return out
}
