import { describe, expect, it } from 'vitest'
import { LARGE_PNG_MIN_BYTES, inspectPngTransparency, shouldOptimizeLargePng } from '../shared/pngOptimization'

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 4, 'ascii')
  return Buffer.concat([header, data, Buffer.alloc(4)])
}

function png(colorType: number, transparentChunk = false): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    ...(transparentChunk ? [chunk('tRNS', Buffer.from([0]))] : []),
    chunk('IDAT', Buffer.alloc(0))
  ])
}

describe('large PNG optimization', () => {
  it('recognizes direct and palette transparency without decoding pixels', () => {
    expect(inspectPngTransparency(png(6))).toBe(true)
    expect(inspectPngTransparency(png(3, true))).toBe(true)
  })

  it('allows only large, opaque PNG files to become JPEGs', () => {
    const opaque = png(2)
    expect(shouldOptimizeLargePng('layout.PNG', LARGE_PNG_MIN_BYTES, opaque)).toBe(true)
    expect(shouldOptimizeLargePng('layout.png', LARGE_PNG_MIN_BYTES - 1, opaque)).toBe(false)
    expect(shouldOptimizeLargePng('layout.jpg', LARGE_PNG_MIN_BYTES, opaque)).toBe(false)
    expect(shouldOptimizeLargePng('layout.png', LARGE_PNG_MIN_BYTES, png(6))).toBe(false)
  })

  it('keeps incomplete or invalid PNG metadata unchanged', () => {
    expect(inspectPngTransparency(Buffer.from('not a png'))).toBe(null)
    expect(shouldOptimizeLargePng('layout.png', LARGE_PNG_MIN_BYTES, SIGNATURE)).toBe(false)
  })
})
