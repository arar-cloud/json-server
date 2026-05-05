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

// Security: Strict operator validation - no eval/Function used
const OPERATOR_VALIDATORS = new Map<WhereOperator, (a: unknown, b: unknown) => boolean>([
  ['eq', (a, b) => a === b],
  ['ne', (a, b) => a !== b],
  ['lt', (a, b) => typeof a === 'number' && typeof b === 'number' && a < b],
  ['lte', (a, b) => typeof a === 'number' && typeof b === 'number' && a <= b],
  ['gt', (a, b) => typeof a === 'number' && typeof b === 'number' && a > b],
  ['gte', (a, b) => typeof a === 'number' && typeof b === 'number' && a >= b],
  ['like', (a, b) => typeof a === 'string' && typeof b === 'string' && a.includes(b)],
  ['in', (a, b) => Array.isArray(b) && b.includes(a)],
  ['nin', (a, b) => Array.isArray(b) && !b.includes(a)],
])

export function getOperatorValidator(
  op: WhereOperator
): ((a: unknown, b: unknown) => boolean) | undefined {
  return OPERATOR_VALIDATORS.get(op)
}

export type WhereOperator = (typeof WHERE_OPERATORS)[number]

export function isWhereOperator(value: string): value is WhereOperator {
  return (WHERE_OPERATORS as readonly string[]).includes(value)
}
