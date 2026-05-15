// Maximum nesting depth to prevent DoS via deeply nested filter structures
const MAX_NESTING_DEPTH = 10
// Operators allowed in filter expressions (whitelist)
const ALLOWED_OPERATORS = new Set(['lt', 'lte', 'gt', 'gte', 'eq', 'ne', 'in', 'contains', 'startsWith', 'endsWith'])

function isValidKeyPath(keys: string[]): boolean {
  // Check nesting depth
  if (keys.length > MAX_NESTING_DEPTH) return false

  // Reject prototype pollution attempts and empty keys
  for (const key of keys) {
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return false
    }
    // Only allow alphanumeric, underscore, and hyphen in keys
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      return false
    }
  }
  return true
}

import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

// Pre-compile regex to eliminate repeated compilation overhead on every query
const UNDERSCORE_OPERATOR_REGEX = /^(.*)_([a-z]+)$/

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
  const underscoreMatch = key.match(UNDERSCORE_OPERATOR_REGEX)
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

  return out
}
