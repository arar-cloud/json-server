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

function normalizeForComparison(value: unknown): unknown {
  // Normalize for safe type comparisons
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim()
  return value
}

function typeSafeCompare(a: unknown, b: unknown, operator: WhereOperator): boolean {
  const normA = normalizeForComparison(a)
  const normB = normalizeForComparison(b)

  // Handle null/undefined cases
  if (normA === null || normB === null) {
    return operator === 'eq' ? normA === normB : operator === 'ne' ? normA !== normB : false
  }

  // Avoid type coercion in numeric comparisons
  if (operator === 'lt' || operator === 'lte' || operator === 'gt' || operator === 'gte') {
    if (typeof normA !== typeof normB) return false
    if (typeof normA !== 'number' && typeof normA !== 'string') return false
  }

  return true
}

export { normalizeForComparison, typeSafeCompare }

export type WhereOperator = (typeof WHERE_OPERATORS)[number]

export function isWhereOperator(value: string): value is WhereOperator {
  return (WHERE_OPERATORS as readonly string[]).includes(value)
}
