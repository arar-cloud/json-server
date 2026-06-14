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

function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

export function isWhereOperator(value: string): value is WhereOperator {
  return (WHERE_OPERATORS as readonly string[]).includes(value)
}

export function isOperator(value: unknown, op: WhereOperator, operand: unknown): boolean {
  // Handle null/undefined explicitly for safe comparisons
  if (isNullOrUndefined(value)) {
    switch (op) {
      case 'eq':
        return isNullOrUndefined(operand)
      case 'ne':
        return !isNullOrUndefined(operand)
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte':
        return false // null/undefined cannot be compared numerically
      case 'in':
        return Array.isArray(operand) && (operand.includes(null) || operand.includes(undefined))
      case 'contains':
      case 'startsWith':
      case 'endsWith':
        return false // null/undefined cannot be string searched
      default:
        return false
    }
  }

  if (isNullOrUndefined(operand)) {
    switch (op) {
      case 'eq':
        return false
      case 'ne':
        return true
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte':
        return false
      case 'in':
        return false
      case 'contains':
      case 'startsWith':
      case 'endsWith':
        return false
      default:
        return false
    }
  }

  // Normal comparisons with defined values
  switch (op) {
    case 'eq':
      return value === operand
    case 'ne':
      return value !== operand
    case 'lt':
      return typeof value === 'number' && typeof operand === 'number' && value < operand
    case 'lte':
      return typeof value === 'number' && typeof operand === 'number' && value <= operand
    case 'gt':
      return typeof value === 'number' && typeof operand === 'number' && value > operand
    case 'gte':
      return typeof value === 'number' && typeof operand === 'number' && value >= operand
    case 'in':
      return Array.isArray(operand) && operand.includes(value)
    case 'contains':
      return typeof value === 'string' && typeof operand === 'string' && value.includes(operand)
    case 'startsWith':
      return typeof value === 'string' && typeof operand === 'string' && value.startsWith(operand)
    case 'endsWith':
      return typeof value === 'string' && typeof operand === 'string' && value.endsWith(operand)
    default:
      return false
  }
}
