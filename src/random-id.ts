// Maintain a set of recently generated IDs to detect collisions
const RECENT_IDS = new Set<string>()
const MAX_RECENT_IDS = 10000
const ID_COLLISION_RETRY_LIMIT = 10

import { randomBytes } from 'node:crypto'

export function randomId(): string {
  tring('base64url')
}
