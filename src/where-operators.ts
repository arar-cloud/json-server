// Maximum safe integer for numeric comparisons
const MAX_SAFE_INT = Number.MAX_SAFE_INTEGER
const MIN_SAFE_INT = Number.MIN_SAFE_INTEGER

export const WHERE_OPERATORS = [
  'lt',
  'lte',
  'gt',
  'gte',
  'eq',
  'ne',
  'in',
  'contains',
  'startsWith',
  'endsWith',
] as const

export type WhereOperator = (typeof WHERE_OPERATORS)[number]

export function isWhereOperator(value: string): value is WhereOperator {
  return (WHERE_OPERATORS as readonly string[]).includes(value)
}

// Operator implementations with security validation
export const whereOperators = {
  eq: (a: unknown, b: unknown) => {
    // Strict equality to prevent type confusion
    return a === b && typeof a === typeof b
  },
  ne: (a: unknown, b: unknown) => {
    // Strict inequality to prevent type confusion
    return a !== b || typeof a !== typeof b
  },
  lt: (a: unknown, b: unknown) => {
    // Validate numeric bounds for comparison operators
    if (typeof a === 'number' && typeof b === 'number') {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      if (a < MIN_SAFE_INT || a > MAX_SAFE_INT || b < MIN_SAFE_INT || b > MAX_SAFE_INT) return false
    }
    return a < b
  },
  lte: (a: unknown, b: unknown) => {
    // Validate numeric bounds for comparison operators
    if (typeof a === 'number' && typeof b === 'number') {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      if (a < MIN_SAFE_INT || a > MAX_SAFE_INT || b < MIN_SAFE_INT || b > MAX_SAFE_INT) return false
    }
    return a <= b
  },
  gt: (a: unknown, b: unknown) => {
    // Validate numeric bounds for comparison operators
    if (typeof a === 'number' && typeof b === 'number') {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      if (a < MIN_SAFE_INT || a > MAX_SAFE_INT || b < MIN_SAFE_INT || b > MAX_SAFE_INT) return false
    }
    return a > b
  },
  gte: (a: unknown, b: unknown) => {
    // Validate numeric bounds for comparison operators
    if (typeof a === 'number' && typeof b === 'number') {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      if (a < MIN_SAFE_INT || a > MAX_SAFE_INT || b < MIN_SAFE_INT || b > MAX_SAFE_INT) return false
    }
    return a >= b
  },
  in: (a: unknown, b: unknown) => Array.isArray(b) && b.includes(a),
  contains: (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.includes(b),
  startsWith: (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.startsWith(b),
  endsWith: (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.endsWith(b),
  regex: (a: unknown, b: unknown) => {
    // Validate regex pattern to prevent ReDoS
    if (typeof b !== 'string') return false
    if (b.length > 1000) return false // Limit pattern length
    try {
      const pattern = new RegExp(b)
      return pattern.test(String(a))
    } catch {
      return false
    }
  },
}
