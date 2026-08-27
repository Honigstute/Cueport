import { describe, expect, it } from 'vitest'
import { formatSequenceTitle } from './sequenceTitles'

describe('formatSequenceTitle', () => {
  it('optionally removes supported image extensions without changing the rest of the name', () => {
    const settings = { hideExtension: true, preferEnding: false }

    expect(formatSequenceTitle('home.desktop.PNG', settings)).toBe('home.desktop')
    expect(formatSequenceTitle('photo.jpeg', settings)).toBe('photo')
    expect(formatSequenceTitle('prototype.MP4', settings)).toBe('prototype')
    expect(formatSequenceTitle('archive.tiff', settings)).toBe('archive.tiff')
  })

  it('keeps the meaningful end of long names when beginning truncation is selected', () => {
    const name = 'project-name-with-a-very-long-prefix-and-important-checkout-confirmation-screen.png'
    const formatted = formatSequenceTitle(name, { hideExtension: true, preferEnding: true })

    expect(formatted.startsWith('…')).toBe(true)
    expect(formatted.endsWith('important-checkout-confirmation-screen')).toBe(true)
    expect(formatted.length).toBe(53)
  })

  it('leaves short names untouched when beginning truncation is selected', () => {
    expect(formatSequenceTitle('checkout.png', { hideExtension: false, preferEnding: true }))
      .toBe('checkout.png')
  })
})
