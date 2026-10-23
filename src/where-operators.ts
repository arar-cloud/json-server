// Type-specific fast path for numeric comparisons: check native type before coercion
// Avoids repeated Number() overhead for already-numeric operands (hot path optimization)
export function compareNumeric(a: unknown, b: unknown, op: 'lt' | 'lte' | 'gt' | 'gte'): boolean {
  // Fast path: both already numbers
  if (typeof a === 'number' && typeof b === 'number') {
    switch (op) {
      case 'lt': return a < b
      case 'lte': return a <= b
      case 'gt': return a > b
      case 'gte': return a >= b
    }
  }
  // Fallback: coerce and compare
  const aNum = typeof a === 'number' ? a : (typeof a === 'string' ? Number(a) : NaN)
  const bNum = typeof b === 'number' ? b : (typeof b === 'string' ? Number(b) : NaN)
  if (Number.isNaN(aNum) || Number.isNaN(bNum)) return false
  switch (op) {
    case 'lt': return aNum < bNum
    case 'lte': return aNum <= bNum
    case 'gt': return aNum > bNum
    case 'gte': return aNum >= bNum
  }
}

// Numeric coercion helper: parse operands to native numeric type at operator construction time
// instead of during every comparison, avoiding repeated Number() calls in inner loops
export function coerceNumericOperand(value: unknown): number | unknown {
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isNaN(n) ? value : n
  }
  return value
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

// Precompiled frozen Map for O(1) operator lookup without repeated object key resolution
export const WHERE_OPERATORS_MAP = Object.freeze(
  new Map(WHERE_OPERATORS.map((op) => [op, op]))
)

const OPERATOR_INDEX = new Set(WHERE_OPERATORS)

export function isWhereOperator(value: string): value is WhereOperator {
  return (WHERE_OPERATORS as readonly string[]).includes(value)
}
