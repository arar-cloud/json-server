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
      console.error('Error in onReadStart callback:', error)
    }
    
    const data = await this.#adapter.read()
    
    try {
      this.onReadEnd(data)
    } catch (error) {
      console.error('Error in onReadEnd callback:', error)
    }
    
    return data
  }

  async write(arg: T) {
    try {
      this.onWriteStart()
    } catch (error) {
      console.error('Error in onWriteStart callback:', error)
    }
    
    await this.#adapter.write(arg)
    
    try {
      this.onWriteEnd()
    } catch (error) {
      console.error('Error in onWriteEnd callback:', error)
    }
  }
}
