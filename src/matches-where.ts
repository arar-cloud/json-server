import type { JsonObject } from 'type-fest'

import { WHERE_OPERATORS, type WhereOperator } from './where-operators.ts'

type OperatorObject = Partial<Record<WhereOperator, unknown>>

// Module-level Set for O(1) operator lookup
const OPERATOR_SET = new Set<string>(WHERE_OPERATORS)

function isJSONObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getKnownOperators(value: unknown): WhereOperator[] {
  if (!isJSONObject(value)) return []

  const ops: WhereOperator[] = []
  // Only check keys that exist in the value object, not all possible operators
  for (const key of Object.keys(value)) {
    if (OPERATOR_SET.has(key)) {
      ops.push(key as WhereOperator)
    }
  }

  return ops
}

export function matchesWhere(obj: JsonObject, where: JsonObject): boolean {
  // Early termination: iterate through where conditions and return false on first mismatch
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
