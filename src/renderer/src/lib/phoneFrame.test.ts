import { describe, expect, it } from 'vitest'
import { calculatePhoneFrameGeometry } from './phoneFrame'

describe('phone frame geometry', () => {
  it('preserves the established phone frame at 100%', () => {
    expect(calculatePhoneFrameGeometry(1)).toEqual({
      bezel: 10,
      screenRadius: 41,
      shellRadius: 51
    })
  })

  it('scales the phone curves while preserving the established bezel', () => {
    expect(calculatePhoneFrameGeometry(2)).toEqual({
      bezel: 10,
      screenRadius: 92,
      shellRadius: 102
    })
    expect(calculatePhoneFrameGeometry(0.5)).toEqual({
      bezel: 10,
      screenRadius: 15.5,
      shellRadius: 25.5
    })
  })

  it('never produces an impossible negative inner radius', () => {
    expect(calculatePhoneFrameGeometry(0.1)).toEqual({
      bezel: 10,
      screenRadius: 0,
      shellRadius: 10
    })
  })

  it('keeps the inner and outer curves concentric', () => {
    const frame = calculatePhoneFrameGeometry(1.75)
    expect(frame.screenRadius + frame.bezel).toBe(frame.shellRadius)
  })

  it('falls back to the 100% geometry for an unusable zoom', () => {
    expect(calculatePhoneFrameGeometry(Number.NaN)).toEqual(calculatePhoneFrameGeometry(1))
    expect(calculatePhoneFrameGeometry(0)).toEqual(calculatePhoneFrameGeometry(1))
  })
})
