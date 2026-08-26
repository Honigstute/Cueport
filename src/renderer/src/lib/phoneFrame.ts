export interface PhoneFrameGeometry {
  bezel: number
  screenRadius: number
  shellRadius: number
}

const PHONE_FRAME_AT_100_PERCENT: PhoneFrameGeometry = {
  bezel: 10,
  screenRadius: 41,
  shellRadius: 51
}

/**
 * Only the phone's curves scale with Canvas. The established 10px bezel stays
 * unchanged, and the inner radius is derived from it so both edges remain
 * concentric: outer shell radius = inner screen radius + bezel.
 */
export function calculatePhoneFrameGeometry(zoom: number): PhoneFrameGeometry {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const bezel = PHONE_FRAME_AT_100_PERCENT.bezel
  const shellRadius = Math.max(bezel, PHONE_FRAME_AT_100_PERCENT.shellRadius * safeZoom)
  return {
    bezel,
    screenRadius: shellRadius - bezel,
    shellRadius
  }
}
