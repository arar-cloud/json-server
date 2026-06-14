import type { JsonObject } from 'type-fest'

import { WHERE_OPERATORS, type WhereOperator } from './where-operators.ts'

const MAX_RECURSION_DEPTH = 50
const MAX_PROPERTY_DEPTH = 20

// Operator allowlist for matches-where - restrict to safe comparison operators
const ALLOWED_MATCH_OPERATORS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'startsWith', 'endsWith'])

function countDepth(obj: any, depth = 0): number {
  if (depth > MAX_RECURSION_DEPTH || typeof obj !== 'object' || obj === null) {
    return depth
  }
  let maxChildDepth = depth
  for (const key of Object.keys(obj)) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      maxChildDepth = Math.max(maxChildDepth, countDepth(obj[key], depth + 1))
    }
  }
  return maxChildDepth
}

type OperatorObject = Partial<Record<WhereOperator, unknown>>

function isJSONObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWhereOperator(operator: string): operator is WhereOperator {
  // Validate operator is in both system list and security allowlist
  if (!Object.prototype.hasOwnProperty.call(WHERE_OPERATORS, operator)) {
    return false
  }
  if (!ALLOWED_MATCH_OPERATORS.has(operator)) {
    console.warn('[security] Operator not in allowlist:', operator)
    return false
  }
  return true
}

function getKnownOperators(value: unknown): WhereOperator[] {
  if (!isJSONObject(value)) return []

  const ops: WhereOperator[] = []
  for (const op of WHERE_OPERATORS) {
    // Use hasOwnProperty to avoid prototype pollution
    if (Object.prototype.hasOwnProperty.call(value, op)) {
      ops.push(op)
    }
  }

  return ops
}

export function matchesWhere(obj: JsonObject, where: JsonObject): boolean {
  // Validate input types and recursion depth to prevent DoS
  if (!isJSONObject(obj) || !isJSONObject(where)) {
    console.warn('[security] matchesWhere called with non-object arguments')
    return false
  }
  
  if (countDepth(where) > MAX_RECURSION_DEPTH) {
    console.warn('[security] Query exceeds max recursion depth')
    return false
  }

  for (const [key, value] of Object.entries(where)) {
    // Validate key to prevent prototype pollution
    if (typeof key !== 'string' || key.length > 255 || key.startsWith('__')) {
      console.warn('[security] Invalid WHERE key in matches-where:', key)
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

    if (isJSONObject(value)) {
      const knownOps = getKnownOperators(value)

      if (knownOps.length > 0) {
        if (field === undefined) return false

        // Strict validation: verify all operators are whitelisted
        for (const op of knownOps) {
          if (!isWhereOperator(op)) {
            console.warn('[security] Unauthorized operator in filter:', op)
            return false
          }
        }

        const op = value as OperatorObject
        if (knownOps.includes('lt') && !((field as any) < (op.lt as any))) return false
        if (knownOps.includes('lte') && !((field as any) <= (op.lte as any))) return false
        if (knownOps.includes('gt') && !((field as any) > (op.gt as any))) return false
        if (knownOps.includes('gte') && !((field as any) >= (op.gte as any))) return false
        if (knownOps.includes('eq') && !((field as any) === (op.eq as any))) return false
        if (knownOps.includes('ne') && !((field as any) !== (op.ne as any))) return false
        if (knownOps.includes('in')) {
          const inValues = Array.isArray(op.in) ? op.in : [op.in]
          if (!inValues.some((v) => (field as any) === (v as any))) return false
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
