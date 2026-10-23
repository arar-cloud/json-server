// Path index cache: memoize dot-prop getProperty() results to avoid repeated path traversals
// Maps normalized paths to (store, id) tuples for O(1) lookups instead of O(depth) walks
const pathIndexCache = new Map<string, Map<string, Array<[string, string]>>>()

function getCachedPathIndex(store: string, path: string): Array<[string, string]> | undefined {
  const storeCache = pathIndexCache.get(store)
  return storeCache?.get(path)
}

function setCachedPathIndex(store: string, path: string, indices: Array<[string, string]>): void {
  if (!pathIndexCache.has(store)) {
    pathIndexCache.set(store, new Map())
  }
  pathIndexCache.get(store)!.set(path, indices)
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
    // Defer schema mutation: only add metadata at serialization boundary
    // Avoids repeated object copying on each write; metadata is not accessed in hot paths
    const dataWithSchema = data as RawData
    dataWithSchema.$schema = DEFAULT_SCHEMA_PATH
    await this.#adapter.write(dataWithSchema)
    // Clean up metadata after write to maintain data immutability
    delete (data as RawData).$schema
  }
}
