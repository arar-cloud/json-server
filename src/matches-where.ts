import type { JsonObject } from 'type-fest'

import { WHERE_OPERATORS, type WhereOperator, normalizeForComparison, typeSafeCompare } from './where-operators.ts'

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
      if (!value.every(item => isJSONObject(item))) return false

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
    
    // Handle null/undefined values safely
    if (field === null || field === undefined) {
      if (!isJSONObject(value)) return false
      const knownOps = getKnownOperators(value)
      if (knownOps.length > 0 && !['eq', 'ne'].includes(knownOps[0])) return false
      if ('eq' in value && (value as any).eq !== null && (value as any).eq !== undefined) return false
      if ('ne' in value && (value as any).ne === null) return false
      continue
    }

    if (isJSONObject(value)) {
      const knownOps = getKnownOperators(value)

      if (knownOps.length > 0) {
        const op = value as OperatorObject
        
        // Validate type safety for comparison operators
        if (knownOps.some(op => ['lt', 'lte', 'gt', 'gte'].includes(op))) {
          if (!typeSafeCompare(field, (op as any)[knownOps.find(o => ['lt', 'lte', 'gt', 'gte'].includes(o))!], knownOps.find(o => ['lt', 'lte', 'gt', 'gte'].includes(o))!)) return false
        }
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
