import type { JsonObject } from 'type-fest'

import { WHERE_OPERATORS, type WhereOperator } from './where-operators.ts'

type OperatorObject = Partial<Record<WhereOperator, unknown>>

function isJSONObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getKnownOperators(value: unknown): WhereOperator[] {
  if (!isJSONObject(value)) return []

  const ops: WhereOperator[] = []
  for (const op of WHERE_OPERATORS) {
    if (op in value) {
      ops.push(op)
    }
  }

  return ops
}

// Operator dispatch map for O(1) lookup instead of regex/string comparison
const OPERATOR_MAP = new Map<string, (a: unknown, b: unknown) => boolean>([
  ['eq', (a, b) => a === b],
  ['ne', (a, b) => a !== b],
  ['lt', (a, b) => (a as any) < (b as any)],
  ['lte', (a, b) => (a as any) <= (b as any)],
  ['gt', (a, b) => (a as any) > (b as any)],
  ['gte', (a, b) => (a as any) >= (b as any)],
  ['in', (a, b) => Array.isArray(b) ? b.some((v) => (a as any) === (v as any)) : false],
  ['nin', (a, b) => Array.isArray(b) ? !b.some((v) => (a as any) === (v as any)) : true],
])

// Cache compiled regex patterns to avoid recompilation
const regexCache = new Map<string, RegExp>()

function getCachedRegex(pattern: string, flags?: string): RegExp {
  const key = `${pattern}:${flags || ''}`
  if (!regexCache.has(key)) {
    regexCache.set(key, new RegExp(pattern, flags))
  }
  return regexCache.get(key)!
}

export function matchesWhere(obj: JsonObject, where: JsonObject): boolean {
  // Pre-index _nin conditions for O(1) lookups on first pass
  const ninIndexes = new Map<string, Set<unknown>>()
  for (const [k, v] of Object.entries(where)) {
    if (k !== 'or' && isJSONObject(v)) {
      const knownOps = getKnownOperators(v)
      if (knownOps.includes('nin') && Array.isArray((v as any).nin)) {
        ninIndexes.set(k, new Set((v as any).nin))
      }
    }
  }

  for (const [key, value] of Object.entries(where)) {
    if (key === 'or') {
      if (!Array.isArray(value) || value.length === 0) return false

      let matched = false
      for (const subWhere of value) {
        if (isJSONObject(subWhere) && matchesWhere(obj, subWhere)) {
          matched = true
          break
        }
      }
      // Short-circuit: return immediately on failure to avoid further traversal
      if (!matched) return false
      continue
    }

    const field = (obj as Record<string, unknown>)[key]

    if (isJSONObject(value)) {
      const knownOps = getKnownOperators(value)

      if (knownOps.length > 0) {
        if (field === undefined) return false

        const op = value as OperatorObject
        if (knownOps.includes('lt') && !((field as any) < (op.lt as any))) return false
        if (knownOps.includes('lte') && !((field as any) <= (op.lte as any))) return false
        if (knownOps.includes('gt') && !((field as any) > (op.gt as any))) return false
        if (knownOps.includes('gte') && !((field as any) >= (op.gte as any))) return false
        if (knownOps.includes('eq') && !((field as any) === (op.eq as any))) return false
        if (knownOps.includes('ne') && !((field as any) !== (op.ne as any))) return false
        if (knownOps.includes('in')) {
          const handler = OPERATOR_MAP.get('in')
          if (!handler || !handler(field, op.in)) return false
        }
        if (knownOps.includes('nin')) {
          const handler = OPERATOR_MAP.get('nin')
          // Early-exit: convert array to Set for O(1) membership testing
          const ninSet = new Set(Array.isArray(op.nin) ? op.nin : [])
          const result = Array.isArray(op.nin) ? !ninSet.has(field) : true
          if (!result) return false
        }
        if (knownOps.includes('contains')) {
          if (typeof field !== 'string') return false
          if (!field.toLowerCase().includes(String(op.contains).toLowerCase())) return false
        }
        if (knownOps.includes('startsWith')) {
          if (typeof field !== 'string') return false
          if (!field.toLowerCase().startsWith(String(op.startsWith).toLowerCase())) return false
        }
        if (knownOps.includes('endsWith')) {
          if (typeof field !== 'string') return false
          if (!field.toLowerCase().endsWith(String(op.endsWith).toLowerCase())) return false
        }
        continue
      }

      if (isJSONObject(field)) {
        // Short-circuit: nested object must match or fail immediately
        if (!matchesWhere(field, value)) return false
      } else {
        // Type mismatch detected: stop processing
        return false
      }
      continue
    }

    if (field === undefined) return false
    
    // Primitive value mismatch
    return false
  }

  return true
}
