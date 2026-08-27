import type { SequenceTitleSettings } from '../types'

const MEDIA_EXTENSION_PATTERN = /\.(?:jpe?g|png|webp|mp4)$/i
const ENDING_PREVIEW_LENGTH = 52

/**
 * Formats only the sequence-card label. The original filename remains intact
 * everywhere else, so display preferences never alter the imported asset.
 */
export function formatSequenceTitle(name: string, settings: SequenceTitleSettings): string {
  const title = settings.hideExtension ? name.replace(MEDIA_EXTENSION_PATTERN, '') : name

  if (!settings.preferEnding || title.length <= ENDING_PREVIEW_LENGTH) return title
  return `…${title.slice(-ENDING_PREVIEW_LENGTH)}`
}
