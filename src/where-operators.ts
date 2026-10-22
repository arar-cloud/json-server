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

// Indexed map for O(1) operator lookup instead of repeated array searches
const OPERATOR_INDEX = new Set(WHERE_OPERATORS)

// Create O(1) lookup Map for operator validation instead of O(n) array scan
const OPERATOR_MAP = new Map<string, WhereOperator>(
  WHERE_OPERATORS.map((op) => [op, op])
)

export function isWhereOperator(value: string): value is WhereOperator {
  // Use Set lookup for O(1) early exit instead of O(n) array search
  return OPERATOR_INDEX.has(value)
}
