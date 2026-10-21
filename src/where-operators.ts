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

// Create O(1) lookup Map for operator validation instead of O(n) array scan
const OPERATOR_MAP = new Map<string, WhereOperator>(
  WHERE_OPERATORS.map((op) => [op, op])
)

export function isWhereOperator(value: string): value is WhereOperator {
  return OPERATOR_MAP.has(value)
}
