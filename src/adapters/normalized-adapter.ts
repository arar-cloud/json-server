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
    // Validate transformed data before writing
    if (!this.validateAdapterOutput(data)) {
      throw new Error('Adapter output validation failed: transformed data does not conform to schema')
    }
    await this.#adapter.write({ ...data, $schema: DEFAULT_SCHEMA_PATH })
  }

  private validateAdapterOutput(obj: unknown): boolean {
    if (typeof obj !== 'object' || obj === null) return false
    
    for (const [key, value] of Object.entries(obj)) {
      // Key must be string
      if (typeof key !== 'string') return false
      
      // Only allow array or object values
      if (!Array.isArray(value) && (typeof value !== 'object' || value === null)) return false
      
      // If array, validate items are objects
      if (Array.isArray(value)) {
        if (!value.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
          return false
        }
      }
    }
    
    return true
  }
}
