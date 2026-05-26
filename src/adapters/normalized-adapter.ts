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
    } catch (error) {
      console.error('NormalizedAdapter read error:', error)
      throw error
    }
  }

  async write(data: Data): Promise<void> {
    try {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Invalid data format for NormalizedAdapter.write')
      }
      await this.#adapter.write({ ...data, $schema: DEFAULT_SCHEMA_PATH })
    } catch (error) {
      console.error('NormalizedAdapter write error:', error)
      throw error
    }
  }
}
