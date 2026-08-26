import { describe, expect, it } from 'vitest'
import { toggleCompleteInterface, toggleSidePanels } from './chrome'

describe('interface visibility shortcuts', () => {
  it('changes only the side panels for a single H press', () => {
    expect(toggleSidePanels('all')).toBe('top')
    expect(toggleSidePanels('sequence')).toBe('top')
    expect(toggleSidePanels('settings')).toBe('top')
    expect(toggleSidePanels('top')).toBe('all')
    expect(toggleSidePanels('hidden')).toBe('all')
  })

  it('changes the complete interface for the eye and a rapid double press', () => {
    expect(toggleCompleteInterface('all')).toBe('hidden')
    expect(toggleCompleteInterface('top')).toBe('hidden')
    expect(toggleCompleteInterface('hidden')).toBe('all')
  })
})
