import type { Adapter } from 'lowdb'

// Lowdb adapter to observe read/write events
export class Observer<T> {
  #adapter: Adapter<T>
  #writeBuffer: Array<() => void> = []
  #isProcessingBatch = false

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
    
    // Buffer write notifications to coalesce rapid successive writes
    this.#writeBuffer.push(() => this.onWriteEnd())
    
    if (!this.#isProcessingBatch) {
      this.#isProcessingBatch = true
      // Defer batch emission to next microtask
      await Promise.resolve()
      this.#flushWriteBuffer()
    }
  }
  
  #flushWriteBuffer() {
    // Emit all buffered write notifications and clear buffer
    while (this.#writeBuffer.length > 0) {
      const callback = this.#writeBuffer.shift()
      callback?.()
    }
    this.#isProcessingBatch = false
  }
}
