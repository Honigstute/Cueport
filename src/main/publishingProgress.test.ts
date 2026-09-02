import { describe, expect, it } from 'vitest'
import {
  PUBLISHING_FINALIZING_PROGRESS,
  PUBLISHING_UPLOAD_READY_PROGRESS,
  publishingProgressForUpload
} from './publishingProgress'

describe('desktop publishing progress', () => {
  it('maps uploaded bytes into the upload portion of the outline', () => {
    expect(publishingProgressForUpload(0, 1_000)).toBe(PUBLISHING_UPLOAD_READY_PROGRESS)
    expect(publishingProgressForUpload(500, 1_000)).toBeCloseTo(0.5)
    expect(publishingProgressForUpload(1_000, 1_000)).toBeLessThan(PUBLISHING_FINALIZING_PROGRESS)
  })

  it('clamps invalid or out-of-range byte counts', () => {
    expect(publishingProgressForUpload(-50, 1_000)).toBe(PUBLISHING_UPLOAD_READY_PROGRESS)
    expect(publishingProgressForUpload(2_000, 1_000)).toBe(publishingProgressForUpload(1_000, 1_000))
    expect(publishingProgressForUpload(0, 0)).toBe(publishingProgressForUpload(1, 0))
  })
})
