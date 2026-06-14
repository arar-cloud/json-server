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
      // Validate data structure before returning
      if (data !== null && typeof data === 'object') {
        const proto = Object.getPrototypeOf(data)
        if (proto !== null && proto !== Object.prototype && proto !== Array.prototype) {
          throw new Error('[security] Invalid data structure from adapter')
        }
      }
      this.onReadEnd(data)
      return data
    } catch (err) {
      console.error('[security] Observer adapter read error:', err)
      throw err
    }
  }

  async write(arg: T) {
    this.onWriteStart()
    await this.#adapter.write(arg)
    this.onWriteEnd()
  }
}
