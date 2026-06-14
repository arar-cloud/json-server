import type { Adapter } from 'lowdb'
import { isAbsolute, relative, resolve } from 'node:path'

// Validate watched path does not escape process.cwd() to prevent symlink/traversal attacks
function validateWatchPath(filePath: string): boolean {
  try {
    const resolved = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
    const rel = relative(process.cwd(), resolved)
    // Reject if path attempts to traverse outside cwd
    if (rel.startsWith('..') || rel.includes('/../')) {
      console.warn('[security] Observer: watch path traversal attempt blocked:', filePath)
      return false
    }
    return true
  } catch (err) {
    console.warn('[security] Observer: invalid watch path:', filePath, err)
    return false
  }
}

// Lowdb adapter to observe read/write events
// Chokidar watch helper with hardened security config
export function createSecureWatcher(watchPath: string) {
  if (!validateWatchPath(watchPath)) {
    throw new Error('Observer: Invalid path for watching')
  }
  // Note: If chokidar is integrated, use: ignoreSymlinks: true, followSymlinks: false
  return null // Placeholder for actual chokidar integration
}

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
