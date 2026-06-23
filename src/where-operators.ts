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

// Safe comparison helpers with type coercion guards
export function safeCompare(a: unknown, b: unknown, op: string): boolean {
  // Handle null/undefined cases
  if (a === null || a === undefined) return op === 'ne' && b !== null && b !== undefined
  if (b === null || b === undefined) return op === 'ne' && a !== null && a !== undefined

  // Numeric comparisons require compatible types
  if (op === 'gte' || op === 'gt' || op === 'lte' || op === 'lt') {
    const numA = Number(a)
    const numB = Number(b)
    if (Number.isNaN(numA) || Number.isNaN(numB)) return false

    switch (op) {
      case 'gte': return numA >= numB
      case 'gt': return numA > numB
      case 'lte': return numA <= numB
      case 'lt': return numA < numB
    }
  }

  return false
}

export function isWhereOperator(value: string): value is WhereOperator {
  return (WHERE_OPERATORS as readonly string[]).includes(value)
}
