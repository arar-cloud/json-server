import type { Adapter } from 'lowdb'

// Lowdb adapter to observe read/write events
export class Observer<T> {
  #adapter: Adapter<T>
  #isDestroyed = false

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
    if (this.#isDestroyed) {
      throw new Error('Observer has been destroyed')
    }
    this.onReadStart()
    const data = await this.#adapter.read()
    if (!this.#isDestroyed) {
      this.onReadEnd(data)
    }
    return data
  }

  async write(arg: T) {
    if (this.#isDestroyed) {
      throw new Error('Observer has been destroyed')
    }
    this.onWriteStart()
    await this.#adapter.write(arg)
    if (!this.#isDestroyed) {
      this.onWriteEnd()
    }
  }

  /**
   * Destroy observer and cleanup all event listeners to prevent memory leaks
   */
  destroy(): void {
    this.#isDestroyed = true
    // Clear all callbacks to break circular references
    this.onReadStart = function () {
      return
    }
    this.onReadEnd = function () {
      return
    }
    this.onWriteStart = function () {
      return
    }
    this.onWriteEnd = function () {
      return
    }
  }
}
