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
    try {
      this.onReadStart()
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      console.error(`[json-server] Observer onReadStart failed: ${err}`)
    }
    
    const data = await this.#adapter.read()
    
    try {
      this.onReadEnd(data)
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      console.error(`[json-server] Observer onReadEnd failed: ${err}`)
    }
    
    return data
  }

  async write(arg: T) {
    try {
      this.onWriteStart()
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      console.error(`[json-server] Observer onWriteStart failed: ${err}`)
    }
    
    await this.#adapter.write(arg)
    
    try {
      this.onWriteEnd()
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      console.error(`[json-server] Observer onWriteEnd failed: ${err}`)
    }
  }
}
