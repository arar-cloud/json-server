import crypto from 'crypto'

// Generate cryptographically secure random IDs to prevent prediction attacks
export function randomId(): string {
  // Generate 16 random bytes and convert to hex (32 char string)
  // This provides 128 bits of entropy (strong collision resistance and unpredictability)
  return crypto.randomBytes(16).toString('hex')
}
