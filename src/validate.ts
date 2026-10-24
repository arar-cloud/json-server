/**
 * Security validation utilities for input sanitization and bounds checking
 */

/**
 * Validates and bounds pagination parameters to prevent DoS attacks
 */
export function validatePaginationParams(
  page: string | number | undefined,
  perPage: string | number | undefined,
): { page: number; perPage: number } {
  const maxPage = 1000000
  const minPerPage = 1
  const maxPerPage = 100000

  let parsedPage = 1
  let parsedPerPage = 10

  if (page !== undefined) {
    const parsed = Number.parseInt(String(page), 10)
    if (Number.isNaN(parsed) || parsed < 1 || parsed > maxPage) {
      throw new Error(`Invalid page parameter: must be between 1 and ${maxPage}`)
    }
    parsedPage = parsed
  }

  if (perPage !== undefined) {
    const parsed = Number.parseInt(String(perPage), 10)
    if (
      Number.isNaN(parsed) ||
      parsed < minPerPage ||
      parsed > maxPerPage
    ) {
      throw new Error(
        `Invalid _per_page parameter: must be between ${minPerPage} and ${maxPerPage}`,
      )
    }
    parsedPerPage = parsed
  }

  return { page: parsedPage, perPage: parsedPerPage }
}

/**
 * Validates that a string is a safe object property key (no prototype pollution)
 */
export function isSafePropertyKey(key: string): boolean {
  const dangerousKeys = [
    '__proto__',
    'constructor',
    'prototype',
    '__constructor__',
  ]
  return !dangerousKeys.includes(key.toLowerCase())
}

/**
 * Validates query parameter keys to prevent injection
 */
export function validateQueryKeys(keys: string[]): void {
  for (const key of keys) {
    if (typeof key !== 'string') {
      throw new Error('Query parameter keys must be strings')
    }
    if (key.length === 0 || key.length > 1000) {
      throw new Error('Query parameter keys must be between 1 and 1000 characters')
    }
    if (!isSafePropertyKey(key)) {
      throw new Error(`Unsafe property key detected: ${key}`)
    }
  }
}

/**
 * Safely parses JSON with strict validation
 */
export function safeJsonParse(
  json: string,
  maxDepth: number = 10,
): Record<string, unknown> {
  let depth = 0
  const maxDepthChecker = (key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      depth++
      if (depth > maxDepth) {
        throw new Error(`JSON nesting depth exceeded maximum of ${maxDepth}`)
      }
    }
    return value
  }

  try {
    const result = JSON.parse(json, maxDepthChecker)
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new Error('Parsed JSON must be an object')
    }
    return result as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid JSON in query parameters: ${error.message}`)
    }
    throw error
  }
}

/**
 * Validates file path to prevent directory traversal attacks
 */
export function validateFilePath(filePath: string): void {
  if (!filePath) {
    throw new Error('File path cannot be empty')
  }
  if (filePath.includes('\0')) {
    throw new Error('File path contains null bytes')
  }
  // Allow absolute paths and relative paths, but reject ../ sequences in relative paths
  if (!filePath.startsWith('/') && filePath.includes('..')) {
    throw new Error('File path cannot contain directory traversal sequences')
  }
}
