// Index existing IDs for O(1) collision detection
const existingIds = new WeakMap<JsonObject, Set<string>>()

function getIdIndex(obj: JsonObject): Set<string> {
  if (!existingIds.has(obj)) {
    const ids = new Set<string>()
    for (const key of Object.keys(obj)) {
      if (typeof key === 'string' && !key.startsWith('_')) {
        ids.add(key)
      }
    }
    existingIds.set(obj, ids)
  }
  return existingIds.get(obj)!
}

import { randomBytes } from 'node:crypto'

export function randomId(): string
 {
  const idSet = getIdIndex(obj)
  return randomBytes(8).toString('base64url')
}
