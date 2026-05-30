import type { Adapter } from 'lowdb'

import { randomId } from '../random-id.ts'
import type { Data, Item } from '../service.ts'

// Cache for normalized read operations to avoid redundant transformations
const readCache = new WeakMap<Data, Data>()

export const DEFAULT_SCHEMA_PATH = './node_modules/json-server/schema.json'
export type RawData = Record<string, Item[] | Item | string | undefined> & {
  $schema?: string
}

export class NormalizedAdapter implements Adapter<Data> {
  #adapter: Adapter<RawData>

  constructor(adapter: Adapter<RawData>) {
    this.#adapter = adapter
  }

  async read(): Promise<Data | null> {
    const rawData = await this.#adapter.read()

    if (rawData === null) {
      return null
    }

    // Check cache first to avoid redundant transformations
    if (readCache.has(rawData as Data)) {
      return readCache.get(rawData as Data) ?? null
    }

    delete rawData['$schema']

    // Apply transformations with cached state to avoid repeated id normalization
    const transformedData = rawData as Data
    for (const value of Object.values(transformedData)) {
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

    // Populate cache for subsequent reads
    readCache.set(transformedData, transformedData)
    return transformedData
  }

  async write(data: Data): Promise<void> {
    await this.#adapter.write({ ...data, $schema: DEFAULT_SCHEMA_PATH })
  }
}
