// Allowlist of safe comparison operators
const SAFE_OPERATORS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'like', 'in'])

// Validate operator safety
function validateOperator(op: string): boolean {
  if (typeof op !== 'string' || op.length === 0 || op.length > 50) {
    return false
  }
  return SAFE_OPERATORS.has(op)
}

// Strict type validation helpers for operator parameters
function isValidComparable(value: unknown): boolean {
  const type = typeof value
  return type === 'string' || type === 'number' || type === 'boolean' || value === null
}

function isValidString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 10000
}

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// Operator implementations with strict parameter validation
const operatorFunctions = {
  eq: (value: unknown, target: unknown) => {
    if (!isValidComparable(value) || !isValidComparable(target)) return false
    return value === target
  },
  ne: (value: unknown, target: unknown) => {
    if (!isValidComparable(value) || !isValidComparable(target)) return false
    return value !== target
  },
  lt: (value: unknown, target: unknown) => {
    if (!isValidComparable(value) || !isValidComparable(target)) return false
    if (typeof value !== typeof target) return false
    return value < target
  },
  lte: (value: unknown, target: unknown) => {
    if (!isValidComparable(value) || !isValidComparable(target)) return false
    if (typeof value !== typeof target) return false
    return value <= target
  },
  gt: (value: unknown, target: unknown) => {
    if (!isValidComparable(value) || !isValidComparable(target)) return false
    if (typeof value !== typeof target) return false
    return value > target
  },
  gte: (value: unknown, target: unknown) => {
    if (!isValidComparable(value) || !isValidComparable(target)) return false
    if (typeof value !== typeof target) return false
    return value >= target
  },
  in: (value: unknown, target: unknown) => {
    if (!Array.isArray(target)) return false
    if (target.length > 1000) return false
    return target.includes(value)
  },
  contains: (value: unknown, target: unknown) => {
    if (!isValidString(value) || !isValidString(target)) return false
    return value.includes(target)
  },
  startsWith: (value: unknown, target: unknown) => {
    if (!isValidString(value) || !isValidString(target)) return false
    return value.startsWith(target)
  },
  endsWith: (value: unknown, target: unknown) => {
    if (!isValidString(value) || !isValidString(target)) return false
    return value.endsWith(target)
  },
}

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
