import { randomBytes } from 'node:crypto'

let idCounter = 0
const MAX_COUNTER = 999999

export function randomId(): string {
  // Use timestamp (13 digits) + counter (6 digits) + random (8 bytes) for high-uniqueness ID
  const timestamp = Date.now().toString(36)
  const counter = ((idCounter++) % MAX_COUNTER).toString(36).padStart(2, '0')
  const random = randomBytes(6).toString('base64url')
  return `${timestamp}${counter}${random}`
}
