import type { JsonObject } from 'type-fest'

import { WHERE_OPERATORS, type WhereOperator } from './where-operators.ts'

type OperatorObject = Partial<Record<WhereOperator, unknown>>

// Dangerous properties that should not be accessed in filters
const DANGEROUS_PROPERTIES = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__proto__',
  'constructor.prototype',
])

function isJSONObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeProperty(key: string): boolean {
  return !DANGEROUS_PROPERTIES.has(key) && !key.startsWith('__')
}

/**
 * Perform strict type coercion check to prevent bypass via type equivalence
 */
function strictEquals(a: unknown, b: unknown): boolean {
  // Strict type and value check
  if (typeof a !== typeof b) return false
  
  // Handle NaN case (NaN !== NaN in JS)
  if (typeof a === 'number' && Number.isNaN(a) && Number.isNaN(b as number)) {
    return true
  }
  
  return a === b
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

function validateRegexPattern(pattern: unknown): boolean {
  if (typeof pattern !== 'string') return false
  // Limit regex pattern length to prevent ReDoS
  if (pattern.length > 1000) return false
  try {
    // Test compilation with timeout
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

export function matchesWhere(obj: JsonObject, where: JsonObject): boolean {
  for (const [key, value] of Object.entries(where)) {
    // Reject filter attempts on dangerous properties
    if (!isSafeProperty(key)) {
      return false
    }
    
    if (key === 'or') {
      if (!Array.isArray(value) || value.length === 0) return false

      let matched = false
      for (const subWhere of value) {
        if (isJSONObject(subWhere) && matchesWhere(obj, subWhere)) {
          matched = true
          break
        }
      }

      if (!matched) return false
      continue
    }

    const field = (obj as Record<string, unknown>)[key]

    // Type coercion protection: if where value is not an object with operators,
    // use strict comparison
    if (!isJSONObject(value)) {
      if (!strictEquals(field, value)) {
        return false
      }
      continue
    }

    if (isJSONObject(value)) {
      const knownOps = getKnownOperators(value)

      if (knownOps.length > 0) {
        if (field === undefined) return false

        const op = value as OperatorObject
        if (knownOps.includes('lt')) {
          if (typeof field !== typeof op.lt || (typeof field !== 'number' && typeof field !== 'string')) return false
          if (!((field as any) < (op.lt as any))) return false
        }
        if (knownOps.includes('lte')) {
          if (typeof field !== typeof op.lte || (typeof field !== 'number' && typeof field !== 'string')) return false
          if (!((field as any) <= (op.lte as any))) return false
        }
        if (knownOps.includes('gt')) {
          if (typeof field !== typeof op.gt || (typeof field !== 'number' && typeof field !== 'string')) return false
          if (!((field as any) > (op.gt as any))) return false
        }
        if (knownOps.includes('gte')) {
          if (typeof field !== typeof op.gte || (typeof field !== 'number' && typeof field !== 'string')) return false
          if (!((field as any) >= (op.gte as any))) return false
        }
        if (knownOps.includes('eq') && !((field as any) === (op.eq as any))) return false
        if (knownOps.includes('ne') && !((field as any) !== (op.ne as any))) return false
        if (knownOps.includes('in')) {
          const inValues = Array.isArray(op.in) ? op.in : [op.in]
          if (!inValues.some((v) => (field as any) === (v as any))) return false
        }
        if (knownOps.includes('regex')) {
          if (typeof field !== 'string') return false
          if (!validateRegexPattern(op.regex)) return false
          try {
            if (!new RegExp(op.regex as string).test(field)) return false
          } catch {
            return false
          }
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
        if (!matchesWhere(field, value)) return false
      }

      continue
    }

    if (field === undefined) return false

    return false
  }

  return true
}
