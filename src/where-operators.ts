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

// Safe numeric comparison with strict type and bounds checking
function safeNumericCompare(a: unknown, b: unknown): boolean {
  if (typeof a !== 'number' || typeof b !== 'number') return false
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  if (Math.abs(a) > 1e308 || Math.abs(b) > 1e308) return false
  return true
}

// Safe string validation to prevent regex injection
function safeRegexTest(str: string, pattern: string): boolean {
  try {
    const regex = new RegExp(escapeRegex(pattern), 'i')
    return regex.test(str)
  } catch {
    return false
  }
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
      if (typeof value !== typeof compare) return false
      return value === compare
    case 'ne':
      if (typeof value !== typeof compare) return true
      return value !== compare
    case 'lt':
      if (!safeNumericCompare(value, compare)) return false
      return (value as number) < (compare as number)
    case 'lte':
      if (!safeNumericCompare(value, compare)) return false
      return (value as number) <= (compare as number)
    case 'gt':
      if (!safeNumericCompare(value, compare)) return false
      return (value as number) > (compare as number)
    case 'gte':
      if (!safeNumericCompare(value, compare)) return false
      return (value as number) >= (compare as number)
    case 'in':
      return Array.isArray(compare) && compare.includes(value)
    case 'contains':
      if (typeof value !== 'string' || typeof compare !== 'string') return false
      return value.includes(compare)
    case 'startsWith':
      if (typeof value !== 'string' || typeof compare !== 'string') return false
      return value.startsWith(compare)
    case 'endsWith':
      if (typeof value !== 'string' || typeof compare !== 'string') return false
      return value.endsWith(compare)
    default:
      return false
  }
}
