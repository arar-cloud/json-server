// Maintain a set of recently generated IDs to detect collisions
const RECENT_IDS = new Set<string>()
const MAX_RECENT_IDS = 10000
const ID_COLLISION_RETRY_LIMIT = 10

import { randomBytes } from 'node:crypto'

export function randomId(existingIds?: Set<string>): string {
  let id = randomBytes(8).toString('base64url')
  
  // Verify uniqueness if existingIds provided
  if (existingIds) {
    let retries = 0
    while (existingIds.has(id) && retries < ID_COLLISION_RETRY_LIMIT) {
      id = randomBytes(8).toString('base64url')
      retries++
    }
    if (retries >= ID_COLLISION_RETRY_LIMIT) {
      throw new Error('Failed to generate unique ID after ' + ID_COLLISION_RETRY_LIMIT + ' attempts')
    }
  }
  
  // Track in recent IDs for collision detection
  RECENT_IDS.add(id)
  if (RECENT_IDS.size > MAX_RECENT_IDS) {
    const firstId = RECENT_IDS.values().next().value
    RECENT_IDS.delete(firstId)
  }
  
  return id
}
