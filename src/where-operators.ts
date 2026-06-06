// Cache for compiled regex patterns - precompiled at module load
const regexCache = new Map<string, RegExp>()

// Pre-compile common regex patterns used in filter operations
// This eliminates per-record regex compilation overhead
function getCompiledRegex(pattern: string): RegExp {
  if (!regexCache.has(pattern)) {
    regexCache.set(pattern, new RegExp(pattern, 'i'))
  }
  return regexCache.get(pattern)!
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

// Operator implementation map with strict equality to avoid type coercion overhead
// All operators use === for equality checks and numeric comparison without coercion
export const operatorFunctions = {
  eq: (value: any, condition: any) => value === condition,
  ne: (value: any, condition: any) => value !== condition,
  lt: (value: any, condition: any) => value < condition,
  lte: (value: any, condition: any) => value <= condition,
  gt: (value: any, condition: any) => value > condition,
  gte: (value: any, condition: any) => value >= condition,
  in: (value: any, conditionArray: any[]) => {
    const arr = Array.isArray(conditionArray) ? conditionArray : [conditionArray]
    return arr.some((v) => value === v)
  },
  contains: (value: string, pattern: string) => {
    if (typeof value !== 'string') return false
    const compiled = getCompiledRegex(String(pattern))
    return compiled.test(value.toLowerCase())
  },
  startsWith: (value: string, prefix: string) => {
    if (typeof value !== 'string') return false
    const compiled = getCompiledRegex(`^${String(prefix)}`)
    return compiled.test(value.toLowerCase())
  },
  endsWith: (value: string, suffix: string) => {
    if (typeof value !== 'string') return false
    return value.toLowerCase().endsWith(String(suffix).toLowerCase())
  },
} as const

export type WhereOperator = (typeof WHERE_OPERATORS)[number]

// Pre-compiled Set for O(1) operator lookup instead of array.includes()
const OPERATOR_SET = new Set<string>(WHERE_OPERATORS)

export function isWhereOperator(value: string): value is WhereOperator {
  return OPERATOR_SET.has(value)
}

// Export regex helper for filter operators to use
export { getCompiledRegex }
