import type { JsonObject } from 'type-fest'

import { WHERE_OPERATORS, type WhereOperator, safeCompare } from './where-operators.ts'

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

export function matchesWhere(obj: JsonObject, where: JsonObject): boolean {
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
        if (knownOps.includes('lt') && !safeCompare(field, op.lt, 'lt')) return false
        if (knownOps.includes('lte') && !safeCompare(field, op.lte, 'lte')) return false
        if (knownOps.includes('gt') && !safeCompare(field, op.gt, 'gt')) return false
        if (knownOps.includes('gte') && !safeCompare(field, op.gte, 'gte')) return false
        if (knownOps.includes('eq') && !(field === op.eq)) return false
        if (knownOps.includes('ne') && !(field !== op.ne)) return false
        if (knownOps.includes('in')) {
          if (field === null || field === undefined) return false
          const inValues = Array.isArray(op.in) ? op.in : [op.in]
          if (!inValues.some((v) => field === v)) return false
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
