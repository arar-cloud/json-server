import { randomUUID } from 'node:crypto'

export function randomId(): string {
  // Use crypto.randomUUID for guaranteed uniqueness in high-concurrency scenarios
  return randomUUID()
}
