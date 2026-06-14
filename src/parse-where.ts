export function validateSortField(field: string): boolean {
  // Validate sort field to prevent injection
  // Allow alphanumeric, underscore, and dot notation for nested fields
  // Reject reserved fields and suspicious patterns
  if (typeof field !== 'string' || field.length === 0) return false
  if (field.startsWith('_') || field.startsWith('$')) return false
  if (field.includes('..') || field.includes('//')) return false
  return /^[a-zA-Z0-9_.\-]+$/.test(field)
}

import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

// WHERE clause security limits
const MAX_WHERE_DEPTH = 10 // Max nesting depth
const MAX_WHERE_KEYS = 100 // Max keys in WHERE object
const MAX_WHERE_KEY_LENGTH = 255 // Max length of property name

// Validate WHERE clause structure to prevent DoS
function validateWhereStructure(obj: any, depth = 0): boolean {
  // Check depth limit
  if (depth > MAX_WHERE_DEPTH) {
    console.warn('[security] WHERE clause exceeds max depth:', depth)
    return false
  }
  
  // Check object key cardinality
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
    const keys = Object.keys(obj)
    if (keys.length > MAX_WHERE_KEYS) {
      console.warn('[security] WHERE clause exceeds max keys:', keys.length)
      return false
    }
    
    // Validate key names and recursively check values
    for (const key of keys) {
      if (typeof key !== 'string' || key.length > MAX_WHERE_KEY_LENGTH) {
        return false
      }
      const value = obj[key]
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        if (!validateWhereStructure(value, depth + 1)) {
          return false
        }
      }
    }
  }
  
  return true
}

// Allowed operators for filtering - explicit allowlist to prevent bypass
const ALLOWED_OPERATORS = new Set<WhereOperator>(['eq', 'lt', 'lte', 'gt', 'gte', 'ne', 'in', 'contains', 'startsWith', 'endsWith'])

function isValidOperator(op: unknown): op is WhereOperator {
  return typeof op === 'string' && ALLOWED_OPERATORS.has(op as WhereOperator)
}

function splitKey(key: string): { path: string; op: WhereOperator | null } {
  // Validate input is a string to prevent prototype pollution
  if (typeof key !== 'string' || key.length === 0) {
    return { path: '', op: null }
  }

  const colonIdx = key.lastIndexOf(':')
  if (colonIdx !== -1) {
    const path = key.slice(0, colonIdx)
    const op = key.slice(colonIdx + 1)
    if (!op) {
      return { path: key, op: 'eq' }
    }

    // Strict validation: only accept if op is a known and allowed operator
    if (isValidOperator(op)) {
      return { path, op }
    }
    // Reject unknown operators
    return { path: key, op: null }
  }

  // Compatibility with v0.17 operator style (e.g. _lt, _gt)
  const underscoreMatch = key.match(/^(.*)_([a-z]+)$/)
  if (underscoreMatch) {
    const path = underscoreMatch[1]
    const op = underscoreMatch[2]
    if (path && isValidOperator(op)) {
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

  // Validate final WHERE structure before returning
  if (!validateWhereStructure(out)) {
    console.warn('[security] WHERE clause failed validation')
    return {}
  }

  return out
}
