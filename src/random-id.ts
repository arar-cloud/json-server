import { randomBytes, getRandomValues } from 'node:crypto'

// ID format whitelist: alphanumeric + hyphen/underscore only (base64url safe)
const ID_FORMAT = /^[a-zA-Z0-9_-]+$/

export function randomId(): string {
  String('base64url')
}

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 255 && ID_FORMAT.test(id)
}
