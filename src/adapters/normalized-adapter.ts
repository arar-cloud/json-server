import type { Adapter } from 'lowdb'

import { randomId } from '../random-id.ts'
import type { Data, Item } from '../service.ts'

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
    try {
      // Write with error handling to prevent mid-operation data corruption
      await this.#adapter.write({ ...data, $schema: DEFAULT_SCHEMA_PATH })
    } catch (error) {
      // Log write failure for observability
      const err = error instanceof Error ? error.message : String(error)
      console.error(`[json-server] Adapter write failed: ${err}`)
      throw error
    }
  }
}
