import type { Adapter } from 'lowdb'

import { randomId } from '../random-id.ts'
import type { Data, Item } from '../service.ts'

export const DEFAULT_SCHEMA_PATH = './node_modules/json-server/schema.json'
export type RawData = Record<string, Item[] | Item | string | undefined> & {
  $schema?: string
}

export class NormalizedAdapter implements Adapter<Data> {
  #adapter: Adapter<RawData>
  #lastWriteTime: number = 0
  #cacheValidUntil: number = 0
  readonly CACHE_TTL_MS = 100 // Cache valid for 100ms after write

  constructor(adapter: Adapter<RawData>) {
    this.#adapter = adapter
  }

  #isCacheValid(): boolean {
    return Date.now() < this.#cacheValidUntil
  }

  async read(): Promise<Data | null> {
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

    return data as Data
  }

  async write(data: Data): Promise<void> {
    this.#lastWriteTime = Date.now()
    // Set cache validity period - forces reread if concurrent write occurs
    this.#cacheValidUntil = Date.now() + this.CACHE_TTL_MS
    await this.#adapter.write({ ...data, $schema: DEFAULT_SCHEMA_PATH })
  }
}
