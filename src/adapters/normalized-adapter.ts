import type { Adapter } from 'lowdb'

import { randomId } from '../random-id.ts'
import type { Data, Item } from '../service.ts'

// Schema validation helper
function validateDataStructure(data: unknown): data is Record<string, unknown> {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  
  // Reject if data is an array (expected to be object)
  if (Array.isArray(data)) {
    return false
  }
  
  // Validate all values are either arrays or objects
  for (const [key, value] of Object.entries(data)) {
    if (typeof key !== 'string') {
      console.warn('[security] Invalid data structure: non-string key')
      return false
    }
    
    if (value === null || value === undefined) {
      continue
    }
    
    if (!Array.isArray(value) && typeof value !== 'object') {
      console.warn('[security] Invalid data structure: non-object/array value for key:', key)
      return false
    }
  }
  
  return true
}

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
    
    // Validate data structure before processing
    if (!validateDataStructure(data)) {
      console.warn('[security] Invalid data structure detected in adapter read')
      return null
    }

    delete data['$schema']

    for (const [key, value] of Object.entries(data)) {
      // Reject suspicious keys
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        console.warn('[security] Rejected malicious key in normalized data:', key)
        continue
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item !== 'object' || item === null) continue
          
          // Strict ID type coercion
          if (Object.prototype.hasOwnProperty.call(item, 'id')) {
            const id = item['id']
            if (typeof id === 'number') {
              // Only coerce safe integers
              if (Number.isSafeInteger(id) && id >= 0) {
                item['id'] = String(id)
              } else {
                console.warn('[security] ID out of safe range, regenerating')
                item['id'] = randomId()
              }
            } else if (typeof id === 'string' && id.length === 0) {
              item['id'] = randomId()
            } else if (typeof id !== 'string') {
              console.warn('[security] Invalid ID type, regenerating')
              item['id'] = randomId()
            }
          } else {
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
    // Validate data structure before writing
    if (!validateDataStructure(data)) {
      console.warn('[security] Invalid data structure in normalized write')
      throw new Error('Data structure validation failed')
    }
    
    await this.#adapter.write({ ...data, $schema: DEFAULT_SCHEMA_PATH })
  }
}
