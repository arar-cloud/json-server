import crypto from 'crypto'

// Generate cryptographically secure random IDs to prevent prediction attacks
export function randomId(): string {
  // Generate 12 random bytes and convert to hex (24 char string)
  // This provides 96 bits of entropy (sufficient for practical collision resistance)
  return crypto.randomBytes(12).toString('hex')
}
