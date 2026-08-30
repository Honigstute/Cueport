import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

const PASSWORD_KEY_LENGTH = 64
const PASSWORD_COST = 16_384
const PASSWORD_BLOCK_SIZE = 8
const PASSWORD_PARALLELISM = 1

function derivePasswordKey(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, {
      N: PASSWORD_COST,
      r: PASSWORD_BLOCK_SIZE,
      p: PASSWORD_PARALLELISM,
      maxmem: 64 * 1024 * 1024
    }, (error, key) => error ? reject(error) : resolve(key))
  })
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a valid email address.')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.')
  }
  return email
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) {
    throw new Error('Use a password with at least 12 characters.')
  }
  return value
}

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function hashPassword(passwordValue: unknown): Promise<string> {
  const password = validatePassword(passwordValue)
  const salt = randomBytes(16)
  const key = await derivePasswordKey(password, salt, PASSWORD_KEY_LENGTH)
  return [
    'scrypt',
    PASSWORD_COST,
    PASSWORD_BLOCK_SIZE,
    PASSWORD_PARALLELISM,
    salt.toString('base64url'),
    key.toString('base64url')
  ].join('$')
}

export async function verifyPassword(password: unknown, stored: string | null): Promise<boolean> {
  if (typeof password !== 'string' || !stored) return false
  const [algorithm, costText, blockText, parallelText, saltText, keyText] = stored.split('$')
  if (algorithm !== 'scrypt' || !saltText || !keyText) return false
  const cost = Number(costText)
  const blockSize = Number(blockText)
  const parallelism = Number(parallelText)
  if (cost !== PASSWORD_COST || blockSize !== PASSWORD_BLOCK_SIZE || parallelism !== PASSWORD_PARALLELISM) return false

  try {
    const expected = Buffer.from(keyText, 'base64url')
    const actual = await derivePasswordKey(password, Buffer.from(saltText, 'base64url'), expected.length)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function encryptionKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error('CUEPORT_SECRET must contain at least 32 characters.')
  return createHash('sha256').update(secret).digest()
}

/** Encrypts recoverable share tokens while their lookup value remains hashed. */
export function encryptToken(token: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function decryptToken(value: string, secret: string): string {
  const [ivText, tagText, ciphertextText] = value.split('.')
  if (!ivText || !tagText || !ciphertextText) throw new Error('A saved share token is unreadable.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final()
  ]).toString('utf8')
}
