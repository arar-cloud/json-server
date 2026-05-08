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

const VALID_OPERATORS = new Set(WHERE_OPERATORS)

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function validateOperator(op: unknown): op is WhereOperator {
  return typeof op === 'string' && VALID_OPERATORS.has(op as WhereOperator)
}

export type WhereOperator = (typeof WHERE_OPERATORS)[number]

export function isWhereOperator(value: string): value is WhereOperator {
  return validateOperator(value)
}

export function applyWhereOperator(
  op: WhereOperator,
  value: unknown,
  compare: unknown,
): boolean {
  switch (op) {
    case 'eq':
      return value === compare
    case 'ne':
      return value !== compare
    case 'lt':
      return (value as any) < (compare as any)
    case 'lte':
      return (value as any) <= (compare as any)
    case 'gt':
      return (value as any) > (compare as any)
    case 'gte':
      return (value as any) >= (compare as any)
    case 'in':
      return Array.isArray(compare) && compare.includes(value)
    case 'contains':
      return String(value).includes(String(compare))
    case 'startsWith':
      return String(value).startsWith(String(compare))
    case 'endsWith':
      return String(value).endsWith(String(compare))
    default:
      return false
  }
}
