// Allowlist of safe comparison operators
const SAFE_OPERATORS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'like', 'in'])

// Validate operator safety
function validateOperator(op: string): boolean {
  if (typeof op !== 'string' || op.length === 0 || op.length > 50) {
    return false
  }
  return SAFE_OPERATORS.has(op)
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
