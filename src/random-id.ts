import { randomBytes } from 'node:crypto'

export function randomId(): string {
  return randomBytes(12).toString('hex')
}
