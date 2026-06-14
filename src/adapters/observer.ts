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
        
        // Deep validation: check all nested objects for prototype pollution
        this.validateNoPrototypePollution(data)
      }
      this.onReadEnd(data)
      return data
    } catch (err) {
      console.error('[security] Observer adapter read error:', err)
      throw err
    }
  }

  private validateNoPrototypePollution(obj: any, depth = 0): void {
    if (depth > 100) {
      throw new Error('[security] Data structure nesting exceeds safe depth')
    }
    
    if (typeof obj !== 'object' || obj === null) {
      return
    }
    
    for (const key of Object.keys(obj)) {
      // Reject dangerous keys
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error(`[security] Prototype pollution attempt detected: ${key}`)
      }
      
      const value = obj[key]
      if (typeof value === 'object' && value !== null) {
        this.validateNoPrototypePollution(value, depth + 1)
      }
    }
  }

  async write(arg: T) {
    // Validate data before write
    if (arg === null || arg === undefined) {
      console.warn('[security] Observer detected null/undefined write attempt')
      throw new Error('Cannot write null or undefined data')
    }
    
    if (typeof arg === 'object' && Object.keys(arg).length === 0) {
      console.warn('[security] Observer detected empty object write')
    }
    
    this.onWriteStart()
    try {
      await this.#adapter.write(arg)
      this.onWriteEnd()
    } catch (error) {
      console.warn('[security] Observer write failed:', error)
      this.onWriteEnd()
      throw error
    }
  }
}
