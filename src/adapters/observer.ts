import type { Adapter } from 'lowdb'

// Lowdb adapter to observe read/write events
export class Observer<T> {
  #adapter: Adapter<T>
  #watchers: Array<{ close: () => void }> = []
  #destroyed = false

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
    const data = await this.#adapter.read()
    this.onReadEnd(data)
    return data
  }

  async write(arg: T) {
    this.onWriteStart()
    await this.#adapter.write(arg)
    this.onWriteEnd()
  }

  addWatcher(watcher: { close: () => void }) {
    if (!this.#destroyed) {
      this.#watchers.push(watcher)
    }
  }

  destroy() {
    if (this.#destroyed) return
    this.#destroyed = true
    for (const watcher of this.#watchers) {
      try {
        watcher.close()
      } catch (err) {
        console.warn('Error closing watcher:', err instanceof Error ? err.message : 'unknown error')
      }
    }
    this.#watchers = []
  }
}
