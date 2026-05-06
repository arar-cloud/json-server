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

/**
 * Validate that an operator is in the allowed list.
 * Prevents dynamic operator injection.
 */
export function isValidOperator(op: unknown): op is WhereOperator {
  if (typeof op !== 'string') return false
  return WHERE_OPERATORS.includes(op as WhereOperator)
}
