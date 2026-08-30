const MAX_AVATAR_BYTES = 1_000_000

export interface DecodedAvatar {
  data: Buffer
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
}

function normalizedText(value: unknown, label: string, maxLength: number, required: boolean): string {
  if (typeof value !== 'string') throw new Error(`Enter ${label}.`)
  const result = value.trim().replace(/\s+/g, ' ')
  if ((required && !result) || result.length > maxLength || /[\u0000-\u001F]/.test(result)) {
    throw new Error(`${required ? 'Enter' : 'Use'} ${label} shorter than ${maxLength + 1} characters.`)
  }
  return result
}

export function normalizeDisplayName(value: unknown): string {
  return normalizedText(value, 'a display name', 80, true)
}

export function normalizeProfileTitle(value: unknown): string {
  return normalizedText(value ?? '', 'a title', 100, false)
}

function avatarMatchesMimeType(data: Buffer, mimeType: DecodedAvatar['mimeType']): boolean {
  if (mimeType === 'image/jpeg') return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  if (mimeType === 'image/png') {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  return data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP'
}

/** Avatars are small raster data URLs so account creation stays atomic. */
export function decodeAvatarDataUrl(value: unknown): DecodedAvatar | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error('Choose a JPEG, PNG, or WebP profile picture.')
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) throw new Error('Choose a JPEG, PNG, or WebP profile picture.')
  const mimeType = match[1] as DecodedAvatar['mimeType']
  const data = Buffer.from(match[2], 'base64')
  if (!data.length || data.length > MAX_AVATAR_BYTES || !avatarMatchesMimeType(data, mimeType)) {
    throw new Error('Use a valid profile picture smaller than 1 MB.')
  }
  return { data, mimeType }
}
