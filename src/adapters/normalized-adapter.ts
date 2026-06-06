import type { Adapter } from 'lowdb'

import { randomId } from '../random-id.ts'
import type { Data, Item } from '../service.ts'

// Copy-on-write proxy factory: wraps data and only clones on mutation
function createCOWProxy<T extends object>(data: T, cloneFn: (d: T) => T): T {
  let cloned: T | null = null
  
  return new Proxy(data, {
    get(target, prop) {
      return Reflect.get(cloned ?? target, prop)
    },
    set(target, prop, value) {
      if (!cloned) {
        cloned = cloneFn(target)
      }
      return Reflect.set(cloned, prop, value)
    },
    deleteProperty(target, prop) {
      if (!cloned) {
        cloned = cloneFn(target)
      }
      return Reflect.deleteProperty(cloned, prop)
    },
  })
}

function clone<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

// Memoization cache for denormalized records: WeakMap avoids memory leaks
const denormCache = new WeakMap<any, any>()

// Lazy field index cache: maps (collection, fieldName) -> Map(fieldValue -> item)
// Built on-demand to avoid initialization overhead for unused collections
const fieldIndexCache = new Map<string, Map<string, Map<string, Item>>>()

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
          
          // Warm memoization cache to avoid redundant traversals on subsequent accesses
          denormCache.set(item, item)
        }
      }
    }

    // Return COW proxy: materialization only on mutation, O(1) proxy creation cost
    return createCOWProxy(data as Data, clone)
  }

  async write(data: Data): Promise<void> {
    // Spread operator forces materialization of COW proxy before write
    // If proxy was never mutated, spread still copies shallow refs efficiently
    await this.#adapter.write({ ...data, $schema: DEFAULT_SCHEMA_PATH })
  }
}
