export const LARGE_PNG_MIN_BYTES = 8 * 1024 * 1024

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0
}

function chunkName(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

/**
 * Reads only PNG structure metadata; pixel decoding is unnecessary. `null`
 * means the supplied prefix ended before transparency could be proven either
 * way, so callers can conservatively keep the original PNG.
 */
export function inspectPngTransparency(bytes: Uint8Array): boolean | null {
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    return null
  }

  let offset: number = PNG_SIGNATURE.length
  let colorType: number | null = null
  while (offset + 8 <= bytes.length) {
    const dataLength = readUint32BigEndian(bytes, offset)
    const type = chunkName(bytes, offset + 4)
    const dataOffset = offset + 8

    if (type === 'IHDR') {
      if (dataLength !== 13 || dataOffset + dataLength > bytes.length) return null
      colorType = bytes[dataOffset + 9]
      if (colorType === 4 || colorType === 6) return true
      if (colorType !== 0 && colorType !== 2 && colorType !== 3) return null
    } else if (type === 'tRNS') {
      return true
    } else if (type === 'IDAT') {
      return colorType === null ? null : false
    }

    const nextOffset = dataOffset + dataLength + 4
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > bytes.length) return null
    offset = nextOffset
  }
  return null
}

export function shouldOptimizeLargePng(fileName: string, fileBytes: number, headerBytes: Uint8Array): boolean {
  return fileName.toLowerCase().endsWith('.png') &&
    fileBytes >= LARGE_PNG_MIN_BYTES &&
    inspectPngTransparency(headerBytes) === false
}
