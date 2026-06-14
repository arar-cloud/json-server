// Safe numeric comparison helpers
function safeNumericCompare(a: unknown, b: unknown, operator: 'lt' | 'lte' | 'gt' | 'gte'): boolean {
  // Convert to numbers safely, reject non-numeric
  const numA = typeof a === 'number' ? a : typeof a === 'string' ? Number(a) : null
  const numB = typeof b === 'number' ? b : typeof b === 'string' ? Number(b) : null

  // Reject if either is null, NaN, or not finite
  if (numA === null || numB === null || !Number.isFinite(numA) || !Number.isFinite(numB)) {
    return false
  }

  // Perform safe comparison
  switch (operator) {
    case 'lt': return numA < numB
    case 'lte': return numA <= numB
    case 'gt': return numA > numB
    case 'gte': return numA >= numB
    default: return false
  }
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
      return safeNumericCompare(value, operand, 'lt')
    case 'lte':
      return safeNumericCompare(value, operand, 'lte')
    case 'gt':
      return safeNumericCompare(value, operand, 'gt')
    case 'gte':
      return safeNumericCompare(value, operand, 'gte')
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
