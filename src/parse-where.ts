import { coerceNumericOperand } from './where-operators.ts'

import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

// Pre-compile regex patterns at module level to enable V8 optimization
// This eliminates per-call regex compilation overhead for high-volume filtering
const BOOLEAN_PATTERN = /^(true|false)$/i
const NULL_PATTERN = /^null$/i
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/

// Fast character-based state machine for numeric detection to avoid regex on every coerceValue call
function isNumericFast(value: string): boolean {
  let hasDot = false
  for (let i = value[0] === '-' ? 1 : 0; i < value.length; i++) {
    const ch = value.charCodeAt(i)
    if (ch === 46) { // '.'
      if (hasDot) return false
      hasDot = true
    } else if (ch < 48 || ch > 57) { // '0'-'9'
      return false
    }
  }
  return value.length > (value[0] === '-' ? 1 : 0)
}

// Pre-build operator suffix Set for O(1) lookup: avoids regex.match() overhead
// when checking if final underscore segment is a known operator
const OPERATOR_SUFFIXES = new Set(['lt', 'lte', 'gt', 'gte', 'eq', 'ne', 'in', 'contains', 'startsWith', 'endsWith'])

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

  // Direct string scan for underscore operator suffix: O(1) lookup via pre-built Set
  // Replaces regex.match() to eliminate compilation and substring allocation overhead
  const lastUnderscoreIdx = key.lastIndexOf('_')
  if (lastUnderscoreIdx > 0 && lastUnderscoreIdx < key.length - 1) {
    const path = key.slice(0, lastUnderscoreIdx)
    const op = key.slice(lastUnderscoreIdx + 1)
    if (OPERATOR_SUFFIXES.has(op as any) && isWhereOperator(op)) {
      return { path, op }
    }
  }

  return { path: key, op: 'eq' }
}

function setPathOp(root: JsonObject, path: string, op: WhereOperator, value: string): void {
  const fullPath = `${path}.${op}`
  if (op === 'in') {
    // Single-pass split with inline coercion to avoid intermediate array allocation
    const parts: (string | number | boolean | null)[] = []
    let partStart = 0
    for (let i = 0; i <= value.length; i++) {
      if (i === value.length || value[i] === ',') {
        parts.push(coerceValue(value.slice(partStart, i).trim()))
        partStart = i + 1
      }
    }
    setProperty(root, fullPath, parts)
    return
  }

  setProperty(root, fullPath, coerceValue(value))
}

function coerceValue(value: string): string | number | boolean | null {
  // Use precompiled patterns for fast type checking without repeated compilation
  if (BOOLEAN_PATTERN.test(value)) return value.toLowerCase() === 'true'
  if (NULL_PATTERN.test(value)) return null

  if (value.trim() === '') return value

  // Precompiled numeric pattern avoids regex creation per call
  if (NUMERIC_PATTERN.test(value)) return Number(value)

  return value
}

export function parseWhere(query: string): JsonObject {
  const out: JsonObject = {}
  const qLen = query.length
  let pos = 0

  // Single-pass character scanning: manually parse instead of URLSearchParams
  // to avoid regex compilation overhead and reduce object allocations
  while (pos < qLen) {
    let ampIdx = qLen
    let eqIdx = -1
    let scanStart = pos

    // Scan for & (pair end) and = (key-value separator) in one pass
    for (let i = pos; i < qLen; i++) {
      const ch = query[i]
      if (ch === '=' && eqIdx === -1) {
        eqIdx = i
      } else if (ch === '&') {
        ampIdx = i
        break
      }
    }

    const pairEnd = ampIdx
    if (pairEnd > scanStart) {
      const rawKey = eqIdx === -1
        ? decodeURIComponent(query.slice(scanStart, pairEnd))
        : decodeURIComponent(query.slice(scanStart, eqIdx))
      const rawValue = eqIdx === -1
        ? ''
        : decodeURIComponent(query.slice(eqIdx + 1, pairEnd))

      const { path, op } = splitKey(rawKey)
      if (op !== null) {
        setPathOp(out, path, op, rawValue)
      }
    }

    pos = pairEnd + 1
  }

  return out
}
