import { describe, expect, it } from 'vitest'
import {
  consumePrivatePresentationReturnPath,
  normalizePrivatePresentationReturnPath,
  rememberPrivatePresentationReturnPath
} from './privatePresentationReturn'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) }
  }
}

describe('private presentation return paths', () => {
  it('remembers and consumes a private presentation path once', () => {
    const storage = memoryStorage()

    rememberPrivatePresentationReturnPath(storage, '/p/abc_123-DEF')

    expect(consumePrivatePresentationReturnPath(storage)).toBe('/p/abc_123-DEF')
    expect(consumePrivatePresentationReturnPath(storage)).toBeNull()
  })

  it.each([
    '/',
    '/presentations',
    '/p/token/extra',
    '//example.com/p/token',
    'https://example.com/p/token',
    '/p/token?redirect=https://example.com'
  ])('rejects non-private and redirect-capable paths: %s', (path) => {
    expect(normalizePrivatePresentationReturnPath(path)).toBeNull()
  })

  it('does not replace a remembered path with an invalid value', () => {
    const storage = memoryStorage()
    rememberPrivatePresentationReturnPath(storage, '/p/first')
    rememberPrivatePresentationReturnPath(storage, 'https://example.com/p/second')

    expect(consumePrivatePresentationReturnPath(storage)).toBe('/p/first')
  })
})
