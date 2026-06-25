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

export const operators = {
  eq: (a: any, b: any) => a === b,
  ne: (a: any, b: any) => a !== b,
  lt: (a: any, b: any) => a != null && b != null && a < b,
  lte: (a: any, b: any) => a != null && b != null && a <= b,
  gt: (a: any, b: any) => a != null && b != null && a > b,
  gte: (a: any, b: any) => a != null && b != null && a >= b,
  in: (a: any, b: any) => Array.isArray(b) && b.includes(a),
  nin: (a: any, b: any) => !Array.isArray(b) || !b.includes(a),
  like: (a: any, b: any) => typeof a === 'string' && typeof b === 'string' && a.includes(b),
}
