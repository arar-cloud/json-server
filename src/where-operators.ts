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
export const operatorFunctions = {
  eq: (value: any, condition: any) => value === condition,
  ne: (value: any, condition: any) => value !== condition,
} as const

export type WhereOperator = (typeof WHERE_OPERATORS)[number]

// Pre-compiled Set for O(1) operator lookup instead of array.includes()
const OPERATOR_SET = new Set<string>(WHERE_OPERATORS)

export function isWhereOperator(value: string): value is WhereOperator {
  return OPERATOR_SET.has(value)
}

// Export regex helper for filter operators to use
export { getCompiledRegex }
