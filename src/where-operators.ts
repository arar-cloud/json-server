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

// Precompiled frozen Map for O(1) operator lookup without repeated object key resolution
export const WHERE_OPERATORS_MAP = Object.freeze(
  new Map(WHERE_OPERATORS.map((op) => [op, op]))
)

const OPERATOR_INDEX = new Set(WHERE_OPERATORS)

export function isWhereOperator(value: string): value is WhereOperator {
  return (WHERE_OPERATORS as readonly string[]).includes(value)
}
