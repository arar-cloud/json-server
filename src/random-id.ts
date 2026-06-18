import { randomBytes } from 'node:crypto'

let idCounter = 0
const idTimestamp = Date.now()

export function randomId(): string {
  // Combine timestamp, counter, and random value for higher entropy
  // This reduces collision probability under high concurrency
  const timestamp = Date.now().toString(36)
  const counter = (++idCounter).toString(36).padStart(5, '0')
  const random = randomBytes(6).toString('base64url')
  
  return `${timestamp}-${counter}-${random}`
}
