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
  onError: (err: Error) => void = function () {
    return
  }

  private safeExecute<R>(fn: () => R, context: string): R | undefined {
    try {
      return fn()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.error(`[json-server] Observer error in ${context}: ${error.message}`)
      this.onError(error)
      return undefined
    }
  }

  constructor(adapter: Adapter<T>) {
    this.#adapter = adapter
  }

  async read() {
    this.safeExecute(() => this.onReadStart(), 'onReadStart')
    const data = await this.#adapter.read()
    this.safeExecute(() => this.onReadEnd(data), 'onReadEnd')
    return data
  }

  async write(arg: T) {
    this.safeExecute(() => this.onWriteStart(), 'onWriteStart')
    await this.#adapter.write(arg)
    this.safeExecute(() => this.onWriteEnd(), 'onWriteEnd')
  }
}
