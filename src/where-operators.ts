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

// Short-circuit comparison operators - return early once result is determined
export function compare(value: unknown, expected: unknown, operator: WhereOperator): boolean {
  switch (operator) {
    case 'lt':
      return (value as number) < (expected as number)
    case 'lte':
      return (value as number) <= (expected as number)
    case 'gt':
      return (value as number) > (expected as number)
    case 'gte':
      return (value as number) >= (expected as number)
    case 'eq':
      return value === expected
    case 'ne':
      return value !== expected
    case 'in':
      return (expected as any[]).includes(value)
    case 'contains':
      return (value as string)?.includes(expected as string) ?? false
    case 'startsWith':
      return (value as string)?.startsWith(expected as string) ?? false
    case 'endsWith':
      return (value as string)?.endsWith(expected as string) ?? false
    default:
      return false
  }
}
