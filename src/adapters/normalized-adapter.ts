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

    // Validate referential integrity
    this.validateIntegrity(data)
    return data as Data
  }

  private validateIntegrity(data: RawData): void {
    // Check for circular references at top level (prevent infinite loops)
    const seen = new WeakSet<object>()
    const validate = (obj: unknown, depth = 0): void => {
      if (depth > 100) {
        throw new Error('[security] Circular reference or excessive nesting detected')
      }
      if (obj && typeof obj === 'object') {
        if (seen.has(obj)) {
          throw new Error('[security] Circular reference detected')
        }
        seen.add(obj)
        for (const value of Object.values(obj)) {
          validate(value, depth + 1)
        }
      }
    }
    validate(data)
  }

  async write(data: Data): Promise<void> {
    await this.#adapter.write({ ...data, $schema: DEFAULT_SCHEMA_PATH })
  }
}
