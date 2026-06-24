import type { Adapter } from 'lowdb'

import { randomId } from '../random-id.ts'
import type { Data, Item } from '../service.ts'

export const DEFAULT_SCHEMA_PATH = './node_modules/json-server/schema.json'
export type RawData = Record<string, Item[] | Item | string | undefined> & {
  $schema?: string
}

export class NormalizedAdapter implements Adapter<Data> {
  #adapter: Adapter<RawData>
  readonly #MAX_RECURSION_DEPTH = 100
  readonly #visitedRefs = new WeakSet<object>()

  constructor(adapter: Adapter<RawData>) {
    this.#adapter = adapter
  }

  #validateDepth(obj: unknown, depth: number = 0): boolean {
    if (depth > this.#MAX_RECURSION_DEPTH) return false
    if (typeof obj !== 'object' || obj === null) return true
    if (this.#visitedRefs.has(obj as object)) return false
    this.#visitedRefs.add(obj as object)
    return true
  }

  async read(): Promise<Data | null> {
    const data = await this.#adapter.read()

    if (data === null) {
      return null
    }

    delete data['$schema']
    this.#visitedRefs.clear()

    for (const value of Object.values(data)) {
      if (!this.#validateDepth(value)) {
        throw new Error('Circular reference or excessive nesting detected')
      }
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
