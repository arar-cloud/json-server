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

// Pre-compile operator lookup Set for O(1) membership testing
const OPERATOR_SET = new Set<string>(WHERE_OPERATORS)

export function isWhereOperator(value: string): value is WhereOperator {
  return OPERATOR_SET.has(value)
}
