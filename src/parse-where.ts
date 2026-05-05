// Allowed operators whitelist for security
const ALLOWED_OPERATORS = new Set([
  'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'like', 'in', 'nin', 'elemMatch', 'regex', 'or'
])

function validateWhereObject(obj: unknown, depth = 0): obj is JsonObject {
  if (depth > MAX_OBJECT_DEPTH) return false
  if (!isJSONObject(obj)) return false

  for (const [key, value] of Object.entries(obj)) {
    // Validate operator names when used with colon notation
    if (key.includes(':')) {
      const op = key.split(':').pop()
      if (op && !ALLOWED_OPERATORS.has(op as WhereOperator)) {
        return false
      }
    }
    // Recursively validate nested objects
    if (isJSONObject(value) && !validateWhereObject(value, depth + 1)) {
      return false
    }
  }
  return true
}

function isJSONObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

// Security: Input validation constants
const MAX_STRING_LENGTH = 10000
const MAX_ARRAY_LENGTH = 1000
const MAX_OBJECT_DEPTH = 50
const MAX_NUMBER = 9007199254740991 // Number.MAX_SAFE_INTEGER
const MIN_NUMBER = -9007199254740991 // -Number.MAX_SAFE_INTEGER

function validateInputDepth(obj: unknown, depth = 0): boolean {
  if (depth > MAX_OBJECT_DEPTH) return false
  if (typeof obj === 'object' && obj !== null) {
    if (Array.isArray(obj)) {
      if (obj.length > MAX_ARRAY_LENGTH) return false
      return obj.every((item) => validateInputDepth(item, depth + 1))
    }
    return Object.values(obj).every((val) => validateInputDepth(val, depth + 1))
  }
  return true
}

function validateString(str: string): boolean {
  return str.length <= MAX_STRING_LENGTH
}

function validateNumber(num: number): boolean {
  return Number.isFinite(num) && num >= MIN_NUMBER && num <= MAX_NUMBER
}

function splitKey(key: string): { path: string; op: WhereOperator | null } {
  if (!validateString(key)) {
    throw new Error('Query parameter key exceeds maximum length')
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

  for (const [rawKey, rawValue] of params.entries()) {
    const { path, op } = splitKey(rawKey)
    if (op === null) continue
    setPathOp(out, path, op, rawValue)
  }

  return out
}
