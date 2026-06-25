import type { Adapter } from 'lowdb'

// Lowdb adapter to observe read/write events
export class Observer<T> {
  #adapter: Adapter<T>
  #subscribers: Array<(data: T) => void> = []

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

  subscribe(callback: (data: T) => void): void {
    this.#subscribers.push(callback)
  }

  private notifySubscribers(data: T) {
    for (const subscriber of this.#subscribers) {
      try {
        subscriber(data)
      } catch (error) {
        // Log error but don't crash: observer errors should not block other subscribers
        console.error('Observer callback error:', error instanceof Error ? error.message : String(error))
      }
    }
  }
}
