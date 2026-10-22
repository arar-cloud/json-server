import type { JsonObject } from 'type-fest'

import { WHERE_OPERATORS, type WhereOperator } from './where-operators.ts'

type OperatorObject = Partial<Record<WhereOperator, unknown>>

// LRU cache for compiled where clauses: stores normalized clause evaluation results
// Bounded to 128 entries to avoid unbounded growth; typical requests use 1-3 filters
class WhereClauseCache {
  private cache: Map<string, boolean> = new Map()
  private maxSize = 128

  key(item: JsonObject, where: JsonObject): string {
    return JSON.stringify(where)
  }

  get(item: JsonObject, where: JsonObject): boolean | undefined {
    const k = this.key(item, where)
    if (this.cache.has(k)) {
      const val = this.cache.get(k)
      // Move to end (LRU)
      this.cache.delete(k)
      this.cache.set(k, val!)
      return val
    }
    return undefined
  }

  set(item: JsonObject, where: JsonObject, result: boolean): void {
    const k = this.key(item, where)
    if (this.cache.size >= this.maxSize && !this.cache.has(k)) {
      // Remove oldest (first)
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.delete(k)
    this.cache.set(k, result)
  }

  clear(): void {
    this.cache.clear()
  }
}

const whereCache = new WhereClauseCache()

function isJSONObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getKnownOperators(value: unknown): WhereOperator[] {
  if (!isJSONObject(value)) return []

  // Cache property descriptor lookups: collect operators in single pass
  const ops: WhereOperator[] = []
  const valueObj = value as Record<string, unknown>
  
  for (const op of WHERE_OPERATORS) {
    if (valueObj.hasOwnProperty(op)) {
      ops.push(op)
    }
  }

  return ops
}

// Create Set for O(1) operator lookup instead of O(n) array.includes() calls
function createOperatorSet(operators: WhereOperator[]): Set<WhereOperator> {
  return new Set(operators)
}

export function matchesWhere(obj: JsonObject, where: JsonObject): boolean {
  // Check cache before evaluating where clause
  const cached = whereCache.get(obj, where)
  if (cached !== undefined) return cached

  const whereEntries = Object.entries(where)
  const whereLength = whereEntries.length

  for (let i = 0; i < whereLength; i++) {
    const [key, value] = whereEntries[i]
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
        // Convert operators array to Set for O(1) lookup instead of O(n) array.includes() calls
        const opSet = new Set(knownOps)
        
        if (opSet.has('lt') && !((field as any) < (op.lt as any))) return false
        if (opSet.has('lte') && !((field as any) <= (op.lte as any))) return false
        if (opSet.has('gt') && !((field as any) > (op.gt as any))) return false
        if (opSet.has('gte') && !((field as any) >= (op.gte as any))) return false
        if (opSet.has('eq') && !((field as any) === (op.eq as any))) return false
        if (opSet.has('ne') && !((field as any) !== (op.ne as any))) return false
        if (opSet.has('in')) {
          const inValues = Array.isArray(op.in) ? op.in : [op.in]
          if (!inValues.some((v) => (field as any) === (v as any))) return false
        }
        if (opSet.has('contains')) {
          if (typeof field !== 'string') return false
          if (!field.toLowerCase().includes(String(op.contains).toLowerCase())) return false
        }
        if (opSet.has('startsWith')) {
          if (typeof field !== 'string') return false
          if (!field.toLowerCase().startsWith(String(op.startsWith).toLowerCase())) return false
        }
        if (opSet.has('endsWith')) {
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

  // Store result in cache for future requests with same where clause
  whereCache.set(obj, where, true)
  return true
}
