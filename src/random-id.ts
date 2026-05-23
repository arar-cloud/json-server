import { randomBytes } from 'node:crypto'

// Cache crypto randomUUID call: reuse crypto.randomUUID for consistency
// Crypto operations are syscalls; caching avoids repeated initialization overhead
export function randomId(): string: string {
  return randomBytes(8).toString('base64url')
}
