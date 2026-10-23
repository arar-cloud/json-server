import { coerceNumericOperand } from './where-operators.ts'

import { setProperty } from 'dot-prop'
import type { JsonObject } from 'type-fest'

import { isWhereOperator, type WhereOperator } from './where-operators.ts'

// Pre-compile regex patterns at module level to enable V8 optimization
// This eliminates per-call regex compilation overhead for high-volume filtering
const OPERATOR_STYLE_REGEX = /^(.*)_([a-z]+)$/
const BOOLEAN_PATTERN = /^(true|false)$/i
const NULL_PATTERN = /^null$/i
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/

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

  // Regex cached at module level (OPERATOR_STYLE_REGEX) to avoid recompilation per call
  // Compatibility with v0.17 operator style (e.g. _lt, _gt)
  const underscoreMatch = key.match(OPERATOR_STYLE_REGEX)
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
