import type { Adapter } from 'lowdb'

import { randomId } from '../random-id.ts'
import type { Data, Item } from '../service.ts'

export const DEFAULT_SCHEMA_PATH = './node_modules/json-server/schema.json'
export type RawData = Record<string, Item[] | Item | string | undefined> & {
  $schema?: string
}

export class NormalizedAdapter implements Adapter<Data> {
  #adapter: Adapter<RawData>
  #normalizedCache: Data | null = null
  #cacheInvalidated = true

  constructor(adapter: Adapter<RawData>) {
    this.#adapter = adapter
  }

  async read(): Promise<Data | null> {
    // Return cached result if cache is valid
    if (!this.#cacheInvalidated && this.#normalizedCache !== null) {
      return this.#normalizedCache
    }

    const data = await this.#adapter.read()

    if (data === null) {
      return null
    }

    delete data['$schema']

    for (const value of Object.values(data)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item['id'] === 'number') {
            item['id'] = item['id'].toString()
          }

          if (item['id'] === undefined) {
            item['id'] = randomId()
          }
        }
      }
    }

    // Cache the normalized result
    this.#normalizedCache = data as Data
    this.#cacheInvalidated = false
    return this.#normalizedCache
  }

  async write(data: Data): Promise<void> {
    // Invalidate cache on write to ensure fresh normalization on next read
    this.#cacheInvalidated = true
    await this.#adapter.write({ ...data, $schema: DEFAULT_SCHEMA_PATH })
  }
}
