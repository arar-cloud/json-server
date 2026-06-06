import type { JsonObject } from 'type-fest'

import { WHERE_OPERATORS, type WhereOperator, getCompiledRegex, operatorFunctions } from './where-operators.ts'

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

// Predicate cache: maps items to clause-result maps for memoization across record evaluations
// Structure: WeakMap<item> -> Map<serialized_clause> -> boolean
const predicateCache = new WeakMap<JsonObject, Map<string, boolean>>()

// Helper to serialize where clause for cache key (avoid JSON.stringify on hot path)
function getClauseKey(clause: JsonObject): string {
  return JSON.stringify(clause)
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
        // Short-circuit evaluation: return false on first failed operator check
        for (const operatorKey of knownOps) {
          const operatorFunc = operatorFunctions[operatorKey as keyof typeof operatorFunctions]
          if (operatorFunc) {
            const result = (operatorFunc as any)(field, op[operatorKey as keyof OperatorObject])
            if (!result) return false
          }
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
