import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

const MAX_WHERE_DEPTH = 5
const MAX_WHERE_SIZE = 5000

const ALLOWED_FIELD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/
const INTERNAL_FIELD_BLOCKLIST = new Set(['__proto__', 'constructor', 'prototype', 'password', 'secret', 'apiKey', 'token'])

function validateFieldName(field: string): boolean {
  // Check pattern: alphanumeric and underscore, dot-notation for nested
  if (!ALLOWED_FIELD_PATTERN.test(field)) return false
  
  // Check each segment against blocklist
  const segments = field.split('.')
  return !segments.some(segment => INTERNAL_FIELD_BLOCKLIST.has(segment))
}

function validateWhereDepth(obj: unknown, depth = 0): boolean {
  if (depth > MAX_WHERE_DEPTH) return false
  if (typeof obj !== 'object' || obj === null) return true
  if (Array.isArray(obj)) return obj.every(item => validateWhereDepth(item, depth + 1))
  return Object.values(obj).every(val => validateWhereDepth(val, depth + 1))
}

function validateWhereSize(str: string): boolean {
  return str.length <= MAX_WHERE_SIZE
}

function splitKey(key: string): { path: string; op: WhereOperator | null } {
  const colonIdx = key.lastIndexOf(':')
  if (colonIdx !== -1) {
    const path = key.slice(0, colonIdx)
    const op = key.slice(colonIdx + 1)
    if (!op) {
      return { path: key, op: 'eq' }
    }

    if (!isWhereOperator(op)) {
      return { path, op: null }
    }
    
    // Validate field name before returning
    if (!validateFieldName(path)) {
      throw new Error(`Invalid field name: ${path}`)
    }
    
    return { path, op }
  }

  // Compatibility with v0.17 operator style (e.g. _lt, _gt)
  const underscoreMatch = key.match(/^(.*)_([a-z]+)$/)
  if (underscoreMatch) {
    const path = underscoreMatch[1]
    const op = underscoreMatch[2]
    if (path && isWhereOperator(op)) {
      // Validate field name before returning
      if (!validateFieldName(path)) {
        throw new Error(`Invalid field name: ${path}`)
      }
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
  if (!validateWhereSize(query)) {
    throw new Error('Where clause exceeds maximum size')
  }

  const out: JsonObject = {}
  const params = new URLSearchParams(query)

  for (const [rawKey, rawValue] of params.entries()) {
    const { path, op } = splitKey(rawKey)
    if (op === null) continue
    setPathOp(out, path, op, rawValue)
  }

  if (!validateWhereDepth(out)) {
    throw new Error('Where clause exceeds maximum nesting depth')
  }

  return out
}
