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

// Maximum recursion depth for query processing to prevent stack overflow
const MAX_RECURSION_DEPTH = 10
let recursionDepth = 0

export function whereOperator(
  op: WhereOperator,
  param: unknown,
  value: unknown,
): boolean {
  recursionDepth++
  if (recursionDepth > MAX_RECURSION_DEPTH) {
    throw new Error(
      `Query recursion depth exceeded maximum of ${MAX_RECURSION_DEPTH}`,
    )
  }

  try {
    return executeWhereOperator(op, param, value)
  } finally {
    recursionDepth--
  }
}

function executeWhereOperator(
  op: WhereOperator,
  param: unknown,
  value: unknown,
): boolean {
  // Validate operator is actually a WhereOperator
  if (!isWhereOperator(op)) {
    throw new Error(`Invalid operator: ${String(op)}`)
  }

  switch (op) {
    case 'lt':
      return param < value
    case 'lte':
      return param <= value
    case 'gt':
      return param > value
    case 'gte':
      return param >= value
    case 'eq':
      return param === value
    case 'ne':
      return param !== value
    case 'in':
      return Array.isArray(value) && value.includes(param)
    case 'contains':
      return (
        typeof param === 'string' &&
        typeof value === 'string' &&
        param.includes(value)
      )
    case 'startsWith':
      return (
        typeof param === 'string' &&
        typeof value === 'string' &&
        param.startsWith(value)
      )
    case 'endsWith':
      return (
        typeof param === 'string' &&
        typeof value === 'string' &&
        param.endsWith(value)
      )
    default:
      const _exhaustive: never = op
      throw new Error(`Unknown operator: ${_exhaustive}`)
  }
}
