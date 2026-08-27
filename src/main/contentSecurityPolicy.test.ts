import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer content security policy', () => {
  it('allows only Cueport-owned local sources for playable media', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')

    expect(html).toContain("media-src 'self' blob: cueport-asset:")
    expect(html).not.toMatch(/media-src[^;]*\*/)
    expect(html).not.toMatch(/media-src[^;]*https?:/)
  })
})
