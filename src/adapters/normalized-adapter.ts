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
    try {
      const data = await this.#adapter.read()

      if (data === null || data === undefined) {
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
    } catch (error) {
      console.error('Error reading from adapter:', error)
      return null
    }
  }

  async write(data: Data): Promise<void> {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid data format for write operation')
    }
    try {
      await this.#adapter.write({ ...data, $schema: DEFAULT_SCHEMA_PATH })
    } catch (error) {
      console.error('Error writing to adapter:', error)
      throw error
    }
  }
}
