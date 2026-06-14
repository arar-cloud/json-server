function validateReferentialIntegrity(data: Record<string, any>, originalData?: Record<string, any>): void {
  // Check for broken foreign key references after mutation
  for (const [resource, items] of Object.entries(data)) {
    if (!Array.isArray(items)) continue

    for (const item of items) {
      if (item && typeof item === 'object') {
        for (const [key, value] of Object.entries(item)) {
          // Check if this looks like a foreign key (e.g., userId, postId)
          if (key.endsWith('Id') || key.endsWith('_id')) {
            const singularResource = key.replace(/Id$/, '').replace(/_id$/, '')
            const pluralResource = singularResource + 's'

            const refData = data[pluralResource] || data[singularResource]
            if (Array.isArray(refData)) {
              if (value !== null && value !== undefined) {
                const found = refData.some(r => r && r.id === value)
                if (!found && originalData && Array.isArray(originalData[pluralResource])) {
                  const wasFound = originalData[pluralResource].some(r => r && r.id === value)
                  if (wasFound) {
                    console.warn(`Broken foreign key reference: ${resource}.${key} -> ${value}`)
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

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
    await this.#adapter.write({ ...data, $schema: DEFAULT_SCHEMA_PATH })
  }
}
