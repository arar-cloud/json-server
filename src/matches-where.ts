import type { JsonObject } from 'type-fest'

import { WHERE_OPERATORS, type WhereOperator } from './where-operators.ts'

type OperatorObject = Partial<Record<WhereOperator, unknown>>

const MAX_RECURSION_DEPTH = 50
const SEEN_OBJECTS = new WeakSet<object>()

function isJSONObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkCircularReference(obj: unknown): void {
  try {
    if (typeof obj === 'object' && obj !== null) {
      if (SEEN_OBJECTS.has(obj)) {
        throw new Error('Circular reference detected in where clause')
      }
      SEEN_OBJECTS.add(obj)
    }
  } catch (error) {
    console.error('Circular reference in where clause:', error instanceof Error ? error.message : error)
    throw error
  }
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
  // Handle null/undefined safely
  if (obj === null || obj === undefined || where === null || where === undefined) {
    return false
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
