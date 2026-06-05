import type { Adapter } from 'lowdb'

// Lowdb adapter to observe read/write events
export class Observer<T> {
  #adapter: Adapter<T>
  #lastEventTime: number = 0
  #pendingEvent: { type: 'read' | 'write'; data?: T } | null = null
  readonly MIN_EVENT_INTERVAL_MS = 10 // Minimum interval between events

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

  #safeCallHook(hook: Function, ...args: unknown[]): void {
    try {
      hook(...args)
    } catch (error) {
      console.error('Observer hook error:', error)
    }
  }

  #hasPendingEvent(): boolean {
    return this.#pendingEvent !== null
  }

  #recordEventTime(): void {
    this.#lastEventTime = Date.now()
    this.#pendingEvent = null
  }

  async read() {
    this.#safeCallHook(this.onReadStart)
    try {
      const data = await this.#adapter.read()
      this.#safeCallHook(this.onReadEnd, data)
      this.#recordEventTime()
      return data
    } catch (error) {
      console.error('Observer read error:', error)
      throw error
    }
  }

  async write(arg: T) {
    this.#safeCallHook(this.onWriteStart)
    try {
      await this.#adapter.write(arg)
      this.#safeCallHook(this.onWriteEnd)
      this.#recordEventTime()
    } catch (error) {
      console.error('Observer write error:', error)
      throw error
    }
  }
}
