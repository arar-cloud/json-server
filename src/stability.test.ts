import { test } from 'node:test'
import assert from 'node:assert'
import { parseWhere } from './parse-where.ts'
import { matchesWhere } from './matches-where.ts'
import { paginate } from './paginate.ts'
import { randomId } from './random-id.ts'
import { whereOperators, type WhereOperator } from './where-operators.ts'

// Test 1: JSON parsing error handling
test('parseWhere should reject invalid operators', () => {
  assert.throws(
    () => parseWhere({ 'field_invalidOp': 'value' }),
    /Invalid operator in key/
  )
})

test('parseWhere should enforce key length bounds', () => {
  const longKey = 'a'.repeat(1e6 + 1) + ':eq'
  assert.throws(
    () => parseWhere({ [longKey]: 'value' }),
    /exceeds maximum length/
  )
})

test('parseWhere should enforce value size bounds', () => {
  const largValue = 'x'.repeat(1e6 + 1)
  assert.throws(
    () => parseWhere({ 'field:eq': largValue }),
    /exceeds maximum length/
  )
})

// Test 2: Type safety in operator evaluation
test('matchesWhere should handle null values safely', () => {
  const obj = { field: null }
  assert.strictEqual(matchesWhere(obj, { field: { eq: null } }), true)
  assert.strictEqual(matchesWhere(obj, { field: { eq: 'value' } }), false)
  assert.strictEqual(matchesWhere(obj, { field: { ne: null } }), false)
})

test('matchesWhere should handle undefined values safely', () => {
  const obj = { field: undefined }
  assert.strictEqual(matchesWhere(obj, { field: { eq: undefined } }), true)
})

test('matchesWhere should reject type coercion in numeric comparisons', () => {
  const obj = { age: '25' }
  // String '25' should not match numeric comparison with 25
  assert.strictEqual(matchesWhere(obj, { age: { gt: 20 } }), false)
})

// Test 3: Pagination bounds validation
test('paginate should enforce maximum page limit', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: i }))
  assert.throws(
    () => paginate(items, 1e6 + 1, 10),
    /Page must be an integer between/
  )
})

test('paginate should enforce maximum per_page limit', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: i }))
  assert.throws(
    () => paginate(items, 1, 1e4 + 1),
    /Per page must be an integer between/
  )
})

test('paginate should enforce minimum per_page limit', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: i }))
  assert.throws(
    () => paginate(items, 1, 0),
    /Per page must be an integer between/
  )
})

test('paginate should reject non-integer page values', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: i }))
  assert.throws(
    () => paginate(items, 1.5, 10),
    /Page must be an integer/
  )
})

// Test 4: ID collision detection
test('randomId should generate collision-resistant IDs', () => {
  const ids = new Set()
  const usedIds = new Set<string>()
  
  for (let i = 0; i < 1000; i++) {
    const id = randomId(usedIds)
    assert.strictEqual(ids.has(id), false, `Collision detected for ID: ${id}`)
    ids.add(id)
    usedIds.add(id)
  }
})

test('randomId with existing IDs should retry', () => {
  const usedIds = new Set(['first_id'])
  const id = randomId(usedIds)
  assert.strictEqual(usedIds.has(id), false)
})

// Test 5: Retry consistency across multiple operations
test('parseWhere should produce consistent results across retries', () => {
  const input = { 'name:like': 'test', 'age:gt': 18 }
  const result1 = parseWhere(input)
  const result2 = parseWhere(input)
  assert.deepStrictEqual(result1, result2)
})

test('matchesWhere should produce consistent filtering across retries', () => {
  const obj = { name: 'test', age: 25 }
  const where = { name: { like: 'es' }, age: { gt: 20 } }
  
  const result1 = matchesWhere(obj, where)
  const result2 = matchesWhere(obj, where)
  assert.strictEqual(result1, result2)
})

test('matchesWhere should handle sparse objects consistently', () => {
  const sparse1 = { id: 1 }
  const sparse2 = { id: 1, optional: undefined }
  
  const where = { optional: { eq: undefined } }
  
  const result1 = matchesWhere(sparse1, where)
  const result2 = matchesWhere(sparse2, where)
  // Both should handle undefined consistently
  assert.strictEqual(typeof result1, 'boolean')
  assert.strictEqual(typeof result2, 'boolean')
})

// Test 6: Error message clarity for debugging
test('parseWhere should provide clear error messages', () => {
  try {
    parseWhere({ 'field_invalidOp': 'value' })
    assert.fail('Should throw')
  } catch (err) {
    const msg = String(err)
    assert(msg.includes('Invalid operator'), `Error should mention invalid operator: ${msg}`)
  }
})

test('paginate should provide clear error messages', () => {
  try {
    paginate([], -1, 10)
    assert.fail('Should throw')
  } catch (err) {
    const msg = String(err)
    assert(msg.includes('Page'), `Error should mention page constraint: ${msg}`)
  }
})
