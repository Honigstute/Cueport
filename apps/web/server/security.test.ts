import { describe, expect, it } from 'vitest'
import { createOpaqueToken, decryptToken, encryptToken, hashPassword, hashToken, normalizeEmail, verifyPassword } from './security'

describe('web security primitives', () => {
  it('normalizes the owner email without changing its identity', () => {
    expect(normalizeEmail(' Steve.Schreiner@GMAIL.com ')).toBe('steve.schreiner@gmail.com')
  })

  it('stores passwords as salted scrypt hashes', async () => {
    const stored = await hashPassword('a long private password')
    expect(stored).not.toContain('a long private password')
    expect(await verifyPassword('a long private password', stored)).toBe(true)
    expect(await verifyPassword('something else entirely', stored)).toBe(false)
  })

  it('encrypts recoverable share tokens and hashes lookup tokens', () => {
    const secret = 'server secret that is definitely longer than thirty two characters'
    const token = createOpaqueToken()
    const encrypted = encryptToken(token, secret)
    expect(encrypted).not.toContain(token)
    expect(decryptToken(encrypted, secret)).toBe(token)
    expect(hashToken(token)).toHaveLength(64)
  })
})
