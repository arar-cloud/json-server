import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

const MAX_WHERE_DEPTH = 10
const MAX_WHERE_COMPLEXITY = 100

function validateWhereDepth(obj: unknown, depth: number = 0, complexity: number = 0): number {
  if (depth > MAX_WHERE_DEPTH) {
    throw new Error(`Where clause nesting depth exceeds maximum (${MAX_WHERE_DEPTH})`)
  }
  if (complexity > MAX_WHERE_COMPLEXITY) {
    throw new Error(`Where clause complexity exceeds maximum (${MAX_WHERE_COMPLEXITY} operators)`)
  }
  let currentComplexity = complexity
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
    for (const value of Object.values(obj)) {
      currentComplexity = validateWhereDepth(value, depth + 1, currentComplexity + 1)
    }
  }
  return currentComplexity
}

function splitKey(key: string): { path: string; op: WhereOperator | null } {
  if (!key || typeof key !== 'string' || key.length === 0) {
    return { path: key, op: null }
  }

  const colonIdx = key.lastIndexOf(':')
  if (colonIdx !== -1) {
    const path = key.slice(0, colonIdx)
    const op = key.slice(colonIdx + 1)
    if (!op || !path) {
      return { path: key, op: null }
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

  for (const [rawKey, rawValue] of params.entries()) {
    const { path, op } = splitKey(rawKey)
    if (op === null) continue
    setPathOp(out, path, op, rawValue)
  }

  try {
    validateWhereDepth(out)
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Where clause validation failed')
  }
  return out
}
