// Debounce and race protection helpers
let debounceTimer: NodeJS.Timeout | null = null
let isReloading = false
const DEBOUNCE_DELAY_MS = 300

async function debouncedReload(reloadFn: () => Promise<void>): Promise<void> {
  if (debounceTimer) clearTimeout(debounceTimer)

  return new Promise((resolve, reject) => {
    debounceTimer = setTimeout(async () => {
      if (isReloading) {
        console.debug('Reload already in progress, skipping duplicate')
        resolve()
        return
      }

      isReloading = true
      try {
        await reloadFn()
        resolve()
      } catch (error) {
        console.error('Reload failed:', error instanceof Error ? error.message : error)
        reject(error)
      } finally {
        isReloading = false
      }
    }, DEBOUNCE_DELAY_MS)
  })
}

import type { Adapter } from 'lowdb'

// Lowdb adapter to observe read/write events
export class Observer<T> {
  #adapter: Adapter<T>

  onReadStart = function () {
    return
  }
  onReadEnd: (data: T | null) => void = function () {
    return
  }
  onWriteStart = function () {
    return
  }
  onWriteEnd = function () {
    return
  }

  constructor(adapter: Adapter<T>) {
    this.#adapter = adapter
  }

  async read() {
    this.onReadStart()
    try {
      const data = await this.#adapter.read()
      this.onReadEnd(data)
      return data
    } catch (error) {
      console.error('Observer read error:', error)
      throw error
    }
  }

  async write(arg: T) {
    this.onWriteStart()
    try {
      await this.#adapter.write(arg)
      this.onWriteEnd()
    } catch (error) {
      console.error('Observer write error:', error)
      throw error
    }
  }
}
