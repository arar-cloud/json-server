import type { Adapter } from 'lowdb'

// Lowdb adapter to observe read/write events
export class Observer<T> {
  #adapter: Adapter<T>
  #writeTimer: NodeJS.Timeout | null = null
  #pendingWrite: T | null = null
  #isWriting = false

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
    // Debounce rapid writes with 150ms window
    this.#pendingWrite = arg
    
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer)
    }
    
    this.#writeTimer = setTimeout(async () => {
      if (this.#isWriting || !this.#pendingWrite) return
      
      this.#isWriting = true
      this.onWriteStart()
      
      try {
        await this.#adapter.write(this.#pendingWrite)
        this.onWriteEnd()
      } finally {
        this.#isWriting = false
        this.#pendingWrite = null
        this.#writeTimer = null
      }
    }, 150)
  }
}
