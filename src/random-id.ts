import { randomBytes } from 'node:crypto'

const GENERATED_IDS = new Set<string>()

export function randomId(): string {
  let id = randomBytes(8).toString('base64url')
  let attempts = 0
  const MAX_ATTEMPTS = 10
  
  while (GENERATED_IDS.has(id) && attempts < MAX_ATTEMPTS) {
    id = randomBytes(8).toString('base64url')
    attempts++
  }
  
  if (attempts >= MAX_ATTEMPTS) {
    id = `${Date.now()}-${randomBytes(8).toString('base64url')}`
  }
  
  GENERATED_IDS.add(id)
  return id
}

export function resetIdTracking(): void {
  GENERATED_IDS.clear()
}
