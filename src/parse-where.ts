// Maximum depth for nested query objects
const MAX_QUERY_DEPTH = 5

function validateQueryDepth(obj: any, depth = 0): void {
  if (depth > MAX_QUERY_DEPTH) {
    throw new Error(`Query nesting depth exceeded maximum of ${MAX_QUERY_DEPTH}`)
  }
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        validateQueryDepth(value, depth + 1)
      }
    }
  }
}

import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

// Dangerous property names that can cause prototype pollution
const DANGEROUS_KEYS = [
  '__proto__',
  'constructor',
  'prototype',
  '__constructor__',
]

function validateKeyForInjection(key: string): void {
  // Validate key format and length
  if (typeof key !== 'string' || key.length === 0 || key.length > 1000) {
    throw new Error(
      'Invalid query parameter key: must be a non-empty string under 1000 characters',
    )
  }

  // Check direct dangerous keys
  if (DANGEROUS_KEYS.includes(key.toLowerCase())) {
    throw new Error(`Unsafe property key detected: ${key}`)
  }

  // Check dangerous keys in path segments
  const segments = key.split('.')
  for (const segment of segments) {
    if (DANGEROUS_KEYS.includes(segment.toLowerCase())) {
      throw new Error(`Unsafe property path detected: ${key}`)
    }
  }
}

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

export function parseWhere(query: string): JsonObject {
  const out: JsonObject = {}
  const params = new URLSearchParams(query)

  for (const [rawKey, rawValue] of params.entries()) {
    validateKeyForInjection(rawKey)
    const { path, op } = splitKey(rawKey)
    if (op === null) continue
    setPathOp(out, path, op, rawValue)
  }

  return out
}
