import type { JsonObject } from 'type-fest'

// Security constants
const MAX_OBJECT_DEPTH = 10
const ALLOWED_OPERATORS = new Set([
  'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'like', 'in', 'nin', 'elemMatch', 'regex', 'or'
])

type WhereOperator = typeof ALLOWED_OPERATORS extends Set<infer U> ? U : never

function isJSONObject(obj: unknown): obj is JsonObject {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
}

function validateWhereObject(obj: unknown, depth = 0): obj is JsonObject {
  if (depth > MAX_OBJECT_DEPTH) return false
  if (!isJSONObject(obj)) return false

  for (const [key, value] of Object.entries(obj)) {
    // Validate operator names when used with colon notation
    if (key.includes(':')) {
      const op = key.split(':').pop()
      if (op && !ALLOWED_OPERATORS.has(op as WhereOperator)) {
        return false
      }
    }
    // Recursively validate nested objects
    if (isJSONObject(value) && !validateWhereObject(value, depth + 1)) {
      return false
    }
  }
  return true
}

export function parseWhere(where: string): JsonObject | null {
  if (!where || typeof where !== 'string') return null
  
  // Enforce string length limit to prevent DoS
  if (where.length > 10000) return null
  
  try {
    const parsed = JSON.parse(where)
    // Validate structure and operators before returning
    if (validateWhereObject(parsed)) {
      return parsed as JsonObject
    }
    return null
  } catch (err) {
    // JSON parse error - return null instead of throwing
    return null
  }
}
